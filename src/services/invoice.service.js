import Invoice from "../models/Invoice.js";
import { generateInvoiceNumber } from "../utils/generateInvoiceNumber.js";
import { generatePdfBuffer, uploadPdfToS3 } from "./pdf.service.js";
import { numberToWords } from "../utils/numberToWords.js";
import User from "../models/userModel.js";
import {
  PayuTransaction,
  RazorpayTransaction,
  Plan,
} from "../models/credits/index.js";
import MyFxd from "../models/MyFxd.js";
import logger from "../config/logger.js";
import SwapTemplate from "../models/SwapTemplate.js";
import settingValueModel from "../models/settingValue.model.js";
import ExchangeRate from "../models/ExchangeRate.js";

// Friendly, gateway-agnostic payment method labels keyed by PayU `mode`.
const PAYMENT_MODE_LABELS = {
  CC: "Credit Card",
  DC: "Debit Card",
  NB: "Net Banking",
  UPI: "UPI",
  EMI: "EMI",
  WALLET: "Wallet",
  CASH: "Cash",
};

export const generateInvoiceForTransaction = async (
  transactionId = null,
  wasOnFreePlan = false,
  isVideoTemplatePurchase = false,
  title = "",
) => {
  try {
    let transaction = await PayuTransaction.findById(transactionId)
      .populate("planId")
      .populate("templateId");
    let isRazorpay = false;

    if (!transaction) {
      transaction = await RazorpayTransaction.findById(transactionId)
        .populate("planId")
        .populate("templateId");
      if (transaction) isRazorpay = true;
    }
    if (!transaction) throw new Error("Transaction not found");

    if (transaction.status !== "success") {
      logger.warn(
        `Attempted to generate invoice for unsuccessful transaction: ${transactionId}`,
      );
      return null;
    }

    const user = await User.findById(transaction.userId);
    if (!user) throw new Error("User not found");

    // Fetch admin for Company Details
    const admin = await User.findOne({
      role: "admin",
      email: "shiv.borade.ai@gmail.com",
    });
    const companyData = {
      name: admin?.businessName,
      address: admin?.address,
      email: admin?.email,
      phone: admin?.phone,
      gstin: admin?.gstNumber,
    };

    const gstSetting = await settingValueModel
      .findOne({ key: "gst_config" })
      .lean();
    const gstConfig = gstSetting?.values || {};
    const gstRate = Number(gstConfig?.gst || 0) || 18;

    // Resolve Company State Code
    let companyStateCode = "27"; // Fallback to Maharashtra
    if (companyData.gstin) {
      companyStateCode = companyData.gstin.substring(0, 2);
    } else if (admin?.state) {
      const stateFxd = await MyFxd.findOne({
        TypeId: 6,
        FxdName: new RegExp(`^${admin.state.trim()}$`, "i"),
      });
      if (stateFxd) companyStateCode = stateFxd.FxdSubName;
    }

    let existingInvoice = await Invoice.findOne({ transactionId });

    const isBillingComplete = Boolean(
      user.phone &&
        user.phone.trim() !== "" &&
        user.address &&
        user.address.trim() !== "" &&
        user.district &&
        user.district.trim() !== "" &&
        user.state &&
        user.state.trim() !== "" &&
        user.pincode &&
        user.pincode.trim() !== "",
    );

    if (existingInvoice) {
      const isStale =
        !existingInvoice.metadata?.client?.address ||
        !existingInvoice.metadata?.client?.contact ||
        existingInvoice.metadata?.client?.address?.includes("N/A");

      const needsUpdate = isBillingComplete && isStale;

      if (!needsUpdate) {
        return existingInvoice;
      }
      logger.info(
        `Regenerating invoice ${existingInvoice.invoiceNumber} for user ${user._id} because billing details are now complete.`,
      );
    }

    const invoiceNumber = existingInvoice
      ? existingInvoice.invoiceNumber
      : await generateInvoiceNumber();

    const totalAmountINR = transaction.amount.value || transaction.amount.total;

    const payuResponse = transaction.payuResponse || {};

    let tempCurrency =
      payuResponse.currency ||
      payuResponse.transaction_currency ||
      payuResponse.field5 ||
      "INR";
    if (tempCurrency === "00") tempCurrency = "INR";
    const customerCurrency = tempCurrency.toUpperCase().trim();

    const customerAmountRaw =
      payuResponse.transaction_amount || payuResponse.field4 || null;

    const customerNumericAmount = Number(customerAmountRaw) || 0;

    const paymentMode =
      payuResponse.mode || transaction.razorpayResponse?.method || "N/A";

    const transactionStatus =
      transaction.status === "success"
        ? "Paid"
        : transaction.status
          ? transaction.status.charAt(0).toUpperCase() +
            transaction.status.slice(1)
          : "Pending";

    const customerCountry = (payuResponse.country || "").toString().trim();

    const isInternational = Boolean(
      (payuResponse.cardCategory &&
        payuResponse.cardCategory.toLowerCase() === "international") ||
        (customerCurrency && customerCurrency !== "INR") ||
        (customerCountry &&
          !["IN", "IND", "INDIA"].includes(customerCountry.toUpperCase())),
    );

    const invoiceCurrency =
      isInternational && customerCurrency && customerNumericAmount > 0
        ? customerCurrency
        : transaction.amount?.currency || "INR";

    const exchangeRate =
      isInternational && customerNumericAmount > 0
        ? totalAmountINR / customerNumericAmount
        : null;

    let exchangeDetailsLabel = null;
    if (isInternational && customerNumericAmount > 0 && exchangeRate) {
      exchangeDetailsLabel = `Charged ₹${totalAmountINR.toFixed(2)} using 1 ${customerCurrency} = ₹${exchangeRate.toFixed(2)}`;
    }

    const conversionRateLabel =
      isInternational && customerNumericAmount > 0 && exchangeRate
        ? `1 ${customerCurrency} = ₹${exchangeRate.toFixed(2)}`
        : null;

    const baseMethodLabel =
      PAYMENT_MODE_LABELS[(payuResponse.mode || "").toUpperCase()];
    const paymentMethodLabel = isInternational
      ? `${baseMethodLabel} (International)`
      : baseMethodLabel;

    let basicValue = 0;
    let gstAmount = 0;

    if (isInternational) {
      basicValue =
        customerNumericAmount > 0 ? customerNumericAmount : totalAmountINR;
      gstAmount = 0;
    } else if (gstRate > 0) {
      basicValue = totalAmountINR / (1 + gstRate / 100);
      gstAmount = totalAmountINR - basicValue;
    } else {
      basicValue = totalAmountINR;
      gstAmount = 0;
    }

    const invoiceDisplayTotal =
      isInternational && customerNumericAmount > 0
        ? customerNumericAmount
        : totalAmountINR;

    const amountInWordsValue = totalAmountINR;

    const addressParts = [
      user.address,
      user.district,
      user.state,
      user.pincode,
    ].filter(
      (part) =>
        part &&
        typeof part === "string" &&
        part.trim() !== "" &&
        part.toUpperCase() !== "N/A",
    );
    const fullAddress = addressParts.join(", ");

    const rawPlanName = transaction.planId?.name;
    const productinfo = (
      transaction.payuResponse?.productinfo ||
      transaction.razorpayResponse?.notes?.productinfo ||
      (isRazorpay ? "credit purchased" : "")
    ).toLowerCase();

    const isYearly =
      productinfo.includes("yearly") ||
      productinfo.includes("year") ||
      productinfo.includes("1 yr") ||
      productinfo.includes("credit purchased");

    let formattedParticulars = rawPlanName;

    if (isVideoTemplatePurchase) {
      formattedParticulars = `Template Purchase - ${title}`;
    } else if (productinfo === "credit purchased") {
      formattedParticulars = "Credit Purchase";
    } else {
      if (rawPlanName === "Free") {
        formattedParticulars = "Credit Plan - Free";
      } else if (rawPlanName === "Lite") {
        formattedParticulars = "Credit Plan (3 days) - Lite";
      } else if (rawPlanName !== "AI Plan") {
        const cycleText = isYearly ? "Yearly" : "Monthly";
        formattedParticulars = `Credit Plan (${cycleText}) - ${rawPlanName}`;
      }
    }

    const stateName = (user.state || "").trim();

    // Resolve Client State Code
    let clientStateCode = "N/A";
    if (stateName) {
      const stateFxd = await MyFxd.findOne({
        TypeId: 6,
        FxdName: new RegExp(`^${stateName}$`, "i"),
      });
      if (stateFxd) {
        clientStateCode = (stateFxd.FxdSubName || "").replace(/^UT\/\s*/i, "");
      }
    }

    // Fallback to GSTIN prefix
    if (
      (clientStateCode === "N/A" || clientStateCode === "") &&
      user.gstNumber
    ) {
      const gstPrefix = user.gstNumber.substring(0, 2);
      if (/^\d+$/.test(gstPrefix)) {
        clientStateCode = gstPrefix;
      }
    }

    const isIntraState = companyStateCode === clientStateCode;

    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    // No GST split for international invoices
    if (!isInternational) {
      if (isIntraState) {
        cgst = gstAmount / 2;
        sgst = gstAmount / 2;
      } else {
        igst = gstAmount;
      }
    }

    const templateData = {
      company: {
        ...companyData,
        stateCode: (companyStateCode || "").replace(/^UT\/\s*/i, ""),
      },
      client: {
        name: user.name,
        address: fullAddress || "N/A",
        email: user.email,
        contact: user.phone || "N/A",
        gstin: user.gstNumber || null,
        stateCode: clientStateCode,
      },
      invoice: {
        number: invoiceNumber,
        date: new Date().toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        placeOfSupply: stateName || "India",
      },
      paymentDetails: {
        merchantAmount: totalAmountINR,
        merchantCurrency: transaction.amount?.currency || "INR",
        customerAmount:
          customerNumericAmount > 0 ? customerNumericAmount : null,
        customerCurrency,
        paymentMode,
        paymentStatus: transactionStatus,
        transactionId:
          transaction.txnid || transaction._id || transaction.id || "N/A",
        conversionRateLabel,
        paymentMethodLabel,
        exchangeDetailsLabel,
      },
      showDiscount: false,
      isInternational,
      invoiceItems: [
        {
          sr: 1,
          particulars: formattedParticulars,
          taxable: basicValue.toFixed(2),
          discountPercentage: "0.00",
          discountAmount: "0.00",
          netBase: basicValue.toFixed(2),
          invoiceCurrency,
        },
      ],
      totals: {
        taxable: basicValue.toFixed(2),
        discountPercentage: "0.00",
        discount: "0.00",
        discountedBase: basicValue.toFixed(2),
        cgst: cgst.toFixed(2),
        sgst: sgst.toFixed(2),
        igst: igst.toFixed(2),
        grand: invoiceDisplayTotal.toFixed(2),
      },
      isMaharashtra: isIntraState,
      amountInWords: numberToWords(amountInWordsValue),
      invoiceCurrency,
    };

    const pdfBuffer = await generatePdfBuffer("invoice.html", templateData);
    const pdfUrl = await uploadPdfToS3(pdfBuffer);

    let invoice;
    const invoicePayload = {
      transactionId,
      transactionModel: isRazorpay ? "RazorpayTransaction" : "PayuTransaction",
      userId: user._id,
      planId: transaction.planId?._id,
      invoiceType: "TRANSIT",
      invoiceNumber,
      pdfLink: pdfUrl,
      amount: totalAmountINR,
      amountInWords: templateData.amountInWords,
      metadata: {
        client: templateData.client,
        transaction: {
          txnid: transaction.txnid,
          amount: totalAmountINR,
          currency: transaction.amount?.currency || "INR",
          productinfo:
            transaction.payuResponse?.productinfo ||
            transaction.razorpayResponse?.notes?.productinfo ||
            null,
          customerAmount:
            customerNumericAmount > 0 ? customerNumericAmount : null,
          customerCurrency,
          isInternational,
          exchangeRate: exchangeRate ? Number(exchangeRate.toFixed(4)) : null,
          payuResponse: {
            country: payuResponse.country,
            cardCategory: payuResponse.cardCategory,
            field4: payuResponse.field4,
            field5: payuResponse.field5,
            transaction_amount: payuResponse.transaction_amount,
            currency: payuResponse.currency,
            transaction_currency: payuResponse.transaction_currency,
            mode: payuResponse.mode,
            PG_TYPE: payuResponse.PG_TYPE,
            error_Message: payuResponse.error_Message,
          },
        },
        plan: {
          name: isVideoTemplatePurchase
            ? "Template Purchase"
            : transaction.planId?.name || null,
          billingCycle: isVideoTemplatePurchase
            ? "none"
            : isYearly
              ? "yearly"
              : "monthly",
        },
      },
      gst: {
        total: Number(gstAmount.toFixed(2)),
        cgst: Number(cgst.toFixed(2)),
        sgst: Number(sgst.toFixed(2)),
        igst: Number(igst.toFixed(2)),
        isIntraState,
      },
    };

    if (existingInvoice) {
      existingInvoice.set(invoicePayload);
      invoice = await existingInvoice.save();
    } else {
      invoice = await Invoice.create(invoicePayload);
    }

    try {
      if (isBillingComplete) {
        const existingFree = await Invoice.findOne({
          userId: user._id,
          invoiceType: "FREE_SIGNUP",
        });
        if (existingFree) {
          const client = existingFree.metadata?.client;
          const isStale =
            (client?.address || "").includes("N/A") ||
            client?.contact === "N/A" ||
            !client?.address ||
            !client?.contact;

          if (isStale) {
            logger.info(`Refreshing stale free invoice for user ${user._id}`);
            await generateFreeSignupInvoice(user._id);
          }
        } else {
          logger.info(
            `Generating missing free invoice for user ${user._id} during transaction processing`,
          );
          await generateFreeSignupInvoice(user._id);
        }
      }
    } catch (err) {
      logger.error(
        "Error refreshing/generating free invoice during transaction:",
        err,
      );
    }

    try {
      if (
        transaction.status === "success" &&
        (transaction.amount.total > 0 || transaction.amount.value > 0)
      ) {
        const { processIncentiveForTransaction } = await import(
          "./incentive.service.js"
        );
        processIncentiveForTransaction(transactionId).catch((err) => {
          logger.error(
            `Error in background incentive processing for txn ${transactionId}:`,
            err,
          );
        });
        logger.info(`Incentive processing triggered for txn ${transactionId}`);
      }
    } catch (e) {
      logger.error("Error triggering incentive processing:", e);
    }

    return invoice;
  } catch (error) {
    logger.error("Error generating invoice:", error);
    throw error;
  }
};

export const generateFreeSignupInvoice = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    const isBillingComplete = Boolean(
      user.phone &&
        user.phone.trim() !== "" &&
        user.address &&
        user.address.trim() !== "" &&
        user.district &&
        user.district.trim() !== "" &&
        user.country &&
        user.country.trim() !== "" &&
        (user.country !== "IN"
          ? true
          : user.state && user.state.trim() !== "") &&
        user.pincode &&
        user.pincode.trim() !== "",
    );

    let existing = await Invoice.findOne({
      userId,
      invoiceType: "FREE_SIGNUP",
    });

    if (existing && isBillingComplete) {
      const needsUpdate =
        existing.metadata?.client?.address === "N/A" ||
        existing.metadata?.client?.contact === "N/A" ||
        !existing.metadata?.client?.address ||
        !existing.metadata?.client?.contact;
      if (needsUpdate) {
        logger.info(
          `Updating existing free invoice for user ${userId} with new billing details`,
        );
      } else {
        return existing;
      }
    }

    if (!isBillingComplete) {
      logger.info(
        `Skipping free invoice generation for ${userId} - billing incomplete`,
      );
      return null;
    }

    if (!user.address || !user.state) {
      logger.warn(
        `Generating partial free invoice for ${userId}: Missing address/state`,
      );
    }

    const freePlan = await Plan.findOne({ name: "Free" });
    const listPrice = freePlan?.creditOptions?.[0]?.price_INR || 1499;

    const admin = await User.findOne({
      role: "admin",
      email: "shiv.borade.ai@gmail.com",
    });
    const companyData = {
      name: admin?.businessName,
      address: admin?.address,
      email: admin?.email,
      phone: admin?.phone,
      gstin: admin?.gstNumber,
    };

    let companyStateCode = "27";
    if (companyData.gstin) companyStateCode = companyData.gstin.substring(0, 2);

    const invoiceNumber = existing
      ? existing.invoiceNumber
      : await generateInvoiceNumber();

    const gstRate = 18;

    // Determine this ONCE, before anything below references it.
    const isInternational = user.country !== "IN";
    let invoiceCurrency = "INR";
    let amount = listPrice;

    if (isInternational) {
      const pricingSettings = await settingValueModel
        .findOne({ key: "country_pricing" })
        .lean();
      const pricingData = pricingSettings?.values?.countryPricing || [];
      const countryConfig = pricingData.find((c) => c.country === user.country);

      invoiceCurrency = countryConfig?.currency || "USD";
      amount = convertInrToCurrency(listPrice, invoiceCurrency); // no `await`
    }

    const basicValue = isInternational
      ? amount
      : Number((listPrice / (1 + gstRate / 100)).toFixed(2));

    const addressParts = [
      user.address,
      user.district,
      user.state,
      user.pincode,
    ].filter(
      (part) =>
        part &&
        typeof part === "string" &&
        part.trim() !== "" &&
        part.toUpperCase() !== "N/A",
    );

    const fullAddress = addressParts.join(", ");
    const stateName = (user.state || "").trim();

    let clientStateCode = "N/A";
    const stateFxd = await MyFxd.findOne({
      TypeId: 6,
      FxdName: new RegExp(`^${stateName}$`, "i"),
    });
    if (stateFxd)
      clientStateCode = (stateFxd.FxdSubName || "").replace(/^UT\/\s*/i, "");

    if (clientStateCode === "N/A" && user.gstNumber) {
      const gstPrefix = user.gstNumber.substring(0, 2);
      if (/^\d+$/.test(gstPrefix)) clientStateCode = gstPrefix;
    }

    const isMaharashtra = clientStateCode === "27";

    const templateData = {
      company: {
        ...companyData,
        stateCode: companyStateCode.replace(/^UT\/\s*/i, ""),
      },
      client: {
        name: user.name,
        address: fullAddress || "N/A",
        email: user.email,
        contact: user.phone || "N/A",
        gstin: user.gstNumber || null,
        stateCode: clientStateCode,
      },
      invoice: {
        number: invoiceNumber,
        date: new Date(user.createdAt || Date.now()).toLocaleDateString(
          "en-GB",
          {
            day: "2-digit",
            month: "short",
            year: "numeric",
          },
        ),
        placeOfSupply: stateName || "India",
      },
      showDiscount: true,
      isInternational,
      isFree: true,
      invoiceCurrency,
      invoiceItems: [
        {
          sr: 1,
          particulars: "Credit Plan - Free",
          taxable: basicValue.toFixed(2),
          discountPercentage: "100.00",
          discountAmount: basicValue.toFixed(2),
          netBase: "0.00",
          invoiceCurrency,
        },
      ],
      totals: {
        taxable: basicValue.toFixed(2),
        discount: basicValue.toFixed(2),
        discountedBase: "0.00",
        cgst: "0.00",
        sgst: "0.00",
        igst: "0.00",
        grand: "0.00",
      },
      isMaharashtra,
      amountInWords: "Zero Only",
    };

    const pdfBuffer = await generatePdfBuffer("invoice.html", templateData);
    const pdfUrl = await uploadPdfToS3(pdfBuffer);

    const invoiceData = {
      userId: user._id,
      planId: freePlan?._id,
      invoiceType: "FREE_SIGNUP",
      invoiceNumber,
      pdfLink: pdfUrl,
      amount: 0,
      amountInWords: "Zero Only",
      metadata: {
        client: templateData.client,
        plan: { name: "Free", billingCycle: "one-time" },
      },
    };

    if (existing) {
      existing.set(invoiceData);
      await existing.save();
      return existing;
    }

    return await Invoice.create(invoiceData);
  } catch (error) {
    logger.error("Error generating free signup invoice:", error);
    throw error;
  }
};

export const getLatestExchangeRates = async () => {
  const doc = await ExchangeRate.findOne().sort({ createdAt: -1 });
  if (!doc) return null;
  return doc.conversion_rates || null; // { INR, EUR, GBP, AED, SGD, JPY, USD }
};

const FALLBACK_INR_RATES = {
  USD: 95.17,
  EUR: 109,
  GBP: 127.93,
  AED: 25.95,
  SGD: 74.31,
  JPY: 0.6,
};

export const convertInrToCurrency = (inrAmount, targetCurrency) => {
  if (targetCurrency === "INR") return Number(inrAmount.toFixed(2));

  const rate = FALLBACK_INR_RATES[targetCurrency];
  if (rate) {
    return Number((inrAmount / rate).toFixed(2));
  }

  // Unknown/unsupported currency — log it so it's never silent
  logger.warn(
    `No hardcoded exchange rate for ${targetCurrency}; returning INR amount unconverted.`,
  );
  return inrAmount;
};
