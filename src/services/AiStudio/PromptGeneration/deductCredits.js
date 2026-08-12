import CreditBalance from "../../models/CreditBalance.js";
import CreditTransaction from "../../models/CreditTransaction.js";

export const deductCredits = async ({
    userId,
    credits,
    referenceId,
    referenceType,
    session = null,
}) => {

    if (!credits || credits <= 0) {
        return;
    }

    let remaining = Number(credits);

    const wallets =
        await CreditBalance.find({
            userId,
            isActive: true,
            validUntil: {
                $gt: new Date(),
            },
            balance: {
                $gt: 0,
            },
        })
            .sort({
                priority: 1,
                validUntil: 1,
            })
            .session(session);

    const totalAvailable =
        wallets.reduce(
            (sum, wallet) =>
                sum + wallet.balance,
            0
        );

    if (totalAvailable < remaining) {
        throw new Error(
            `Insufficient credits. Required ${remaining}, Available ${totalAvailable}.`
        );
    }

    for (const wallet of wallets) {

        if (remaining <= 0) {
            break;
        }

        const deduction =
            Math.min(
                wallet.balance,
                remaining
            );

        wallet.balance -= deduction;

        remaining -= deduction;

        await wallet.save({
            session,
        });

        await CreditTransaction.create(
            [
                {
                    userId,

                    creditBalance: wallet._id,

                    type: "debit",

                    credits: deduction,

                    referenceId,

                    referenceType,

                    description:
                        `${referenceType} generation`,
                },
            ],
            {
                session,
            }
        );

    }

};