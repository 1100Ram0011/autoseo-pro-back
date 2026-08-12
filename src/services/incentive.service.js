import Referral from "../models/Referral.js";
import IncentiveTransaction from "../models/IncentiveTransaction.js";
import User from "../models/userModel.js";
import { PayuTransaction, RazorpayTransaction } from "../models/credits/index.js";
import Invoice from "../models/Invoice.js";
import { getSlabPercentage } from "../models/IncentiveSlabMaster.js";
import logger from "../config/logger.js";


/**
 * Get total transaction amount for a beneficiary user in the current month.
 */
const getMonthlyTransactionTotal = async (beneficiaryUserId) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const result = await IncentiveTransaction.aggregate([
    {
      $match: {
        beneficiaryUserId,
        createdAt: { $gte: startOfMonth, $lte: endOfMonth },
      },
    },
    {
      $group: {
        _id: null,
        totalTransactionAmount: { $sum: "$transactionAmount" },
      },
    },
  ]);

  return result[0]?.totalTransactionAmount || 0;
};


export const processIncentiveForTransaction = async (transactionId) => {
  try {
    let transaction = await PayuTransaction.findById(transactionId).populate("planId");
    let isRazorpay = false;
    if (!transaction) {
      transaction = await RazorpayTransaction.findById(transactionId).populate("planId");
      if (transaction) isRazorpay = true;
    }
    if (!transaction || transaction.status !== "success") return null;

    const originalInvoice = await Invoice.findOne({ transactionId });

    const referredUser = await User.findById(transaction.userId);
    if (!referredUser) return null;

    let parentId = referredUser.parentId;

    if (!parentId) {
      // Fallback check: check if this email exists in Referral model
      const referral = await Referral.findOne({ email: referredUser.email });
      if (referral && referral.parentId) {
        parentId = referral.parentId;
        // Auto-fix the missing parentId on user record
        referredUser.parentId = parentId;
        await referredUser.save();
        logger.info(`Linked user ${referredUser.email} to parent ID ${parentId} from Referral model during incentive processing`);
      }
    }

    if (!parentId) return null;

    const beneficiaryUser = await User.findById(parentId);
    if (!beneficiaryUser || beneficiaryUser.isDeleted) return null;
    
    // Auto-enable incentive for beneficiary if not already enabled
    if (!beneficiaryUser.incentiveEnabled) {
      beneficiaryUser.incentiveEnabled = true;
      await beneficiaryUser.save();
      logger.info(`Auto-enabled incentives for beneficiary ${beneficiaryUser.email}`);
    }

    const existing = await IncentiveTransaction.findOne({ transactionId });
    if (existing) {
      logger.info(`Incentive already exists for transaction ${transactionId}. Skipping.`);
      return existing;
    }

    const amount = transaction.amount?.total || transaction.amount?.value || transaction.amount || 0;
  
    if (amount <= 0) {
      logger.info(`Incentive skipped: Transaction amount is zero or negative.`);
      return null;
    }

    // Calculate Net Amount (Excluding 18% GST)
    const netAmount = amount / 1.18;

    // Get monthly gross total for this beneficiary in current month
    const monthlyGrossTotal = await getMonthlyTransactionTotal(beneficiaryUser._id);
    
    // Net Business for slab lookup = (Already processed gross + current gross) / 1.18
    const projectedNetBusinessTotal = (monthlyGrossTotal + amount) / 1.18;

    // Get slab-based percentage from the IncentiveSlabMaster using the Net Business
    const percentage = await getSlabPercentage(projectedNetBusinessTotal);

    const incentiveAmount = (netAmount * percentage) / 100;
    
    logger.info(`Incentive Calc: Gross ₹${amount} -> Net ₹${netAmount.toFixed(2)}. Slab lookup value: ₹${projectedNetBusinessTotal.toFixed(2)}. Slab: ${percentage}%. Incentive: ₹${incentiveAmount.toFixed(2)}`);

    const incentiveTxn = await IncentiveTransaction.create({
      beneficiaryUserId: beneficiaryUser._id,
      referredUserId: referredUser._id,
      transactionId: transaction._id,
      transactionModel: isRazorpay ? "RazorpayTransaction" : "PayuTransaction",
      transactionAmount: amount,
      incentivePercentage: percentage,
      incentiveAmount: incentiveAmount,
      referredInvoiceNumber: originalInvoice?.invoiceNumber || "",
      planName: transaction.planId?.name || "Premium Plan",
      billingCycle: (
        transaction.payuResponse?.productinfo ||
        transaction.razorpayResponse?.notes?.productinfo ||
        ""
      ).toLowerCase().includes("yearly") ? "yearly" : "monthly",
      status: "approved",
      notes: `Incentive for ${referredUser.name}'s purchase of ${transaction.planId?.name || 'Plan'}`
    });

    logger.info(`Incentive record created: ₹${incentiveAmount} (${percentage}%) for ${beneficiaryUser.email}`);
    return incentiveTxn;
  } catch (err) {
    logger.error("[processIncentiveForTransaction] Error:", err);
    return null;
  }
};
