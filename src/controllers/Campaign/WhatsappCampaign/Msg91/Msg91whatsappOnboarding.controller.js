import mongoose from "mongoose";
import WhatsappOnboarding from "../../../../models/Campaign/WhatsappCampaign/Msg91/Msg91WhatsappOnboardingSchema.js";
import WhatsappActivation from "../../../../models/Campaign/WhatsappCampaign/Msg91/Msg91WhatsappActivationNumberSchema.js";

const getUserId = (req) => req.user?._id || req.user?.id || null;

const handleError = (res, error, fallback = "Server error") => {
    if (error.name === "ValidationError") {
        return res.status(400).json({
            success: false,
            message: "Validation failed",
            errors: error.errors
        });
    }
    return res.status(500).json({
        success: false,
        message: error.message || fallback
    });
};

/* =====================================================
   STEP 1 — User submits the form
   POST /api/whatsapp/onboarding
   Body: {
       whatsappNumbers: ["91XXX", "91YYY"],
       businessName, businessEmail,
       facebookPageId, facebookPageName, userNotes
   }
===================================================== */
// export const submitOnboardingForm = async (req, res) => {
//     try {
//         const userId = getUserId(req);

//         if (!userId)
//             return res.status(401).json({ success: false, message: "Unauthorized" });

//         const {
//             whatsappNumbers,
//             businessName,
//             businessEmail,
//             facebookPageId,
//             facebookPageName,
//             userNotes
//         } = req.body;

//         // ── Validation ────────────────────────────────────────────────────────
//         if (!Array.isArray(whatsappNumbers) || whatsappNumbers.length === 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: "whatsappNumbers must be a non-empty array"
//             });
//         }

//         if (!businessName || !businessEmail) {
//             return res.status(400).json({
//                 success: false,
//                 message: "businessName and businessEmail are required"
//             });
//         }

//         // ── Duplicate check ───────────────────────────────────────────────────
//         const existingRequest = await WhatsappOnboarding.findOne({
//             userId,
//             "whatsappNumbers.number": { $in: whatsappNumbers },
//             connectionStatus: { $nin: ["REJECTED", "CANCELLED"] }
//         });

//         if (existingRequest) {
//             return res.status(409).json({
//                 success: false,
//                 message: "One or more numbers already have an active onboarding request",
//                 data: existingRequest
//             });
//         }

//         // ── Create ────────────────────────────────────────────────────────────
//         const onboarding = await WhatsappOnboarding.create({
//             userId,
//             whatsappNumbers: whatsappNumbers.map((number) => ({
//                 number,
//                 status: "PENDING"
//             })),
//             businessName,
//             businessEmail,
//             facebookPageId: facebookPageId || null,
//             facebookPageName: facebookPageName || null,
//             userNotes: userNotes || null,
//             connectionStatus: "PENDING"
//         });




//         return res.status(201).json({
//             success: true,
//             message: `Form submitted for ${whatsappNumbers.length} number(s). Please add our Facebook account as admin, then confirm.`,
//             data: onboarding,
//             nextStep: {
//                 action: "fb_admin_confirm",
//                 endpoint: `PATCH /api/whatsapp/onboarding/${onboarding._id}/fb-confirm`,
//                 instruction: "Add our Facebook Business Manager as admin to your page, then hit the confirm endpoint."
//             }
//         });

//     } catch (error) {
//         return handleError(res, error, "Failed to submit onboarding form");
//     }
// };

export const submitOnboardingForm = async (req, res) => {
    try {
        const userId = getUserId(req)

        if (!userId)
            return res.status(401).json({ success: false, message: "Unauthorized" })

        const {
            whatsappNumbers,
            businessName,
            businessEmail,
            businessPhone,
            businessIndustry,
            userName,
            userFullName,
            userNotes,
            connectionType,
            facebookPageId,
            facebookPageName,
        } = req.body

        let connectionStatus = null;
        let fbAdminConfirmed = false;

        // ── Validation ────────────────────────────────────────────────────────
        if (!Array.isArray(whatsappNumbers) || whatsappNumbers.length === 0)
            return res.status(400).json({ success: false, message: "whatsappNumbers must be a non-empty array" })

        if (!businessEmail)
            return res.status(400).json({ success: false, message: "businessName, businessEmail are required" })

        // if (connectionType === 'msg91' && (!userName || !userFullName))
        //     return res.status(400).json({ success: false, message: "userName, userFullName are required" })

        // if (connectionType === 'facebook' && (!facebookPageId || !facebookPageName))
        //     return res.status(400).json({ success: false, message: "facebookPageId, facebookPageName are required" })

        // ── Duplicate check ───────────────────────────────────────────────────
        const existingRequest = await WhatsappOnboarding.findOne({
            userId,
            "whatsappNumbers.number": { $in: whatsappNumbers },
            connectionStatus: { $nin: ["REJECTED", "CANCELLED"] }
        })

        if (existingRequest)
            return res.status(409).json({
                success: false,
                message: "One or more numbers already have an active request",
                data: existingRequest
            })

        connectionStatus = 'PENDING'
        fbAdminConfirmed = false

        // ── Call MSG91 add_client ─────────────────────────────────────────────
        let msg91Response = null
        let msg91Error = null

        if (connectionType === 'msg91') {
            try {
                const params = new URLSearchParams({
                    authkey: config.MSG91_AUTHKEY,
                    user_full_name: userFullName,
                    user_mobile_number: businessPhone || whatsappNumbers[0],
                    user_company_name: businessName,
                    user_industry: businessIndustry || "Technology",
                    services: "WHATSAPP",
                    user_name: userName,
                    user_email: businessEmail,
                })

                const msg91Res = await axios.get(
                    `http://control.msg91.com/api/add_client.php?${params.toString()}`,
                    { timeout: 15000 }
                )

                msg91Response = msg91Res.data

                connectionStatus = 'SUBMITTED'

            } catch (err) {
                // Don't fail the whole request — save locally and flag for retry
                msg91Error = err?.response?.data || err.message
                console.error("MSG91 add_client error:", msg91Error)
                connectionStatus = 'PENDING'
            }
        }

        // ── Save onboarding record ────────────────────────────────────────────
        const onboarding = await WhatsappOnboarding.create({
            userId,
            whatsappNumbers: whatsappNumbers.map(number => ({ number, status: "PENDING" })),
            businessName,
            businessEmail,
            businessPhone: businessPhone || null,
            businessIndustry: businessIndustry || null,
            userName,
            userFullName,
            userNotes: userNotes || null,

            // Skip FB steps — MSG91 handles Meta
            fbAdminConfirmed: true,
            fbAdminConfirmedAt: new Date(),

            connectionStatus,
            submittedAt: msg91Error ? null : new Date(),

            msg91Response,
            msg91Error: msg91Error ? String(msg91Error) : null,
        })

        return res.status(201).json({
            success: true,
            message: msg91Error
                ? "Request saved. MSG91 submission failed — will retry."
                : `Request submitted to MSG91 for ${whatsappNumbers.length} number(s). Our team will activate shortly.`,
            data: onboarding,
        })

    } catch (error) {
        return handleError(res, error, "Failed to submit onboarding form")
    }
}

/* =====================================================
   STEP 2 — User confirms FB admin was added
   PATCH /api/whatsapp/onboarding/:id/fb-confirm
===================================================== */
export const confirmFbAdmin = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id))
            return res.status(400).json({ success: false, message: "Invalid ID" });

        const onboarding = await WhatsappOnboarding.findOne({ _id: id, userId });

        if (!onboarding)
            return res.status(404).json({ success: false, message: "Onboarding request not found" });

        if (onboarding.connectionStatus !== "PENDING") {
            return res.status(400).json({
                success: false,
                message: `Cannot confirm at this stage. Current status: ${onboarding.connectionStatus}`
            });
        }

        onboarding.fbAdminConfirmed = true;
        onboarding.fbAdminConfirmedAt = new Date();
        onboarding.connectionStatus = "FB_CONFIRMED";

        await onboarding.save();

        return res.status(200).json({
            success: true,
            message: "Facebook admin confirmation recorded. You can now submit your connection request.",
            data: onboarding,
            nextStep: {
                action: "submit_connection_request",
                endpoint: `PATCH /api/whatsapp/onboarding/${id}/submit`
            }
        });

    } catch (error) {
        return handleError(res, error, "Failed to confirm FB admin");
    }
};

/* =====================================================
   STEP 3 — User submits connection request
   PATCH /api/whatsapp/onboarding/:id/submit
===================================================== */
export const submitConnectionRequest = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id))
            return res.status(400).json({ success: false, message: "Invalid ID" });

        const onboarding = await WhatsappOnboarding.findOne({ _id: id, userId });

        if (!onboarding)
            return res.status(404).json({ success: false, message: "Onboarding request not found" });

        if (onboarding.connectionStatus !== "FB_CONFIRMED") {
            return res.status(400).json({
                success: false,
                message: "Please confirm Facebook admin access before submitting connection request"
            });
        }

        onboarding.connectionStatus = "SUBMITTED";
        onboarding.submittedAt = new Date();

        await onboarding.save();

        // TODO: notify admin (email / slack / internal alert)

        return res.status(200).json({
            success: true,
            message: "Connection request submitted. Our team will review and approve your number(s).",
            data: onboarding
        });

    } catch (error) {
        return handleError(res, error, "Failed to submit connection request");
    }
};

/* =====================================================
   USER — Cancel own request
   PATCH /api/whatsapp/onboarding/:id/cancel
===================================================== */
export const cancelOnboardingRequest = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id))
            return res.status(400).json({ success: false, message: "Invalid ID" });

        const onboarding = await WhatsappOnboarding.findOne({ _id: id, userId });

        if (!onboarding)
            return res.status(404).json({ success: false, message: "Onboarding request not found" });

        if (["APPROVED", "CANCELLED"].includes(onboarding.connectionStatus)) {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel a request in "${onboarding.connectionStatus}" state`
            });
        }

        onboarding.connectionStatus = "CANCELLED";

        await onboarding.save();

        return res.status(200).json({
            success: true,
            message: "Onboarding request cancelled.",
            data: onboarding
        });

    } catch (error) {
        return handleError(res, error, "Failed to cancel request");
    }
};

/* =====================================================
   ADMIN — Approve / partial approve request
   PATCH /api/whatsapp/onboarding/:id/approve
   Body: {
       approvedNumbers: ["91XXX"],           // optional — omit to approve all
       rejectedNumbers: [{ number, reason }], // optional
       adminNotes: "..."
   }
===================================================== */
export const approveConnectionRequest = async (req, res) => {
    try {
        const adminId = getUserId(req);
        const { id } = req.params;

        const {
            adminNotes,
            approvedNumbers,  // string[] | undefined
            rejectedNumbers   // { number, reason }[] | undefined
        } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id))
            return res.status(400).json({ success: false, message: "Invalid ID" });

        const onboarding = await WhatsappOnboarding.findById(id);

        if (!onboarding)
            return res.status(404).json({ success: false, message: "Onboarding request not found" });

        if (onboarding.connectionStatus !== "SUBMITTED") {
            return res.status(400).json({
                success: false,
                message: `Cannot approve. Current status: ${onboarding.connectionStatus}`
            });
        }

        const now = new Date();
        const activationBulkOps = [];

        // ── Update each number status ─────────────────────────────────────────
        onboarding.whatsappNumbers = onboarding.whatsappNumbers.map((entry) => {
            const rejectedEntry = rejectedNumbers?.find((r) => r.number === entry.number);
            const isApproved = approvedNumbers
                ? approvedNumbers.includes(entry.number)
                : true;  // no filter = approve all

            if (rejectedEntry) {
                entry.status = "REJECTED";
                entry.rejectionReason = rejectedEntry.reason || null;

            } else if (isApproved) {
                entry.status = "APPROVED";
                entry.activatedAt = now;

                activationBulkOps.push({
                    updateOne: {
                        filter: {
                            userId: onboarding.userId,
                            integrated_number: entry.number
                        },
                        update: {
                            $set: { isActive: true, updatedAt: now }
                        },
                        upsert: true
                    }
                });
            }

            return entry;
        });

        // ── Set overall status ────────────────────────────────────────────────
        const allRejected = onboarding.whatsappNumbers.every((n) => n.status === "REJECTED");
        const someApproved = onboarding.whatsappNumbers.some((n) => n.status === "APPROVED");

        onboarding.connectionStatus = allRejected ? "REJECTED"
            : someApproved ? "APPROVED"
                : "REJECTED";

        onboarding.reviewedBy = adminId;
        onboarding.reviewedAt = now;
        onboarding.adminNotes = adminNotes || null;

        await onboarding.save({ validateBeforeSave: false });

        // ── Write approved numbers to WhatsappActivation ──────────────────────
        if (activationBulkOps.length) {
            await WhatsappActivation.bulkWrite(activationBulkOps, { ordered: false });
        }

        return res.status(200).json({
            success: true,
            message: `${activationBulkOps.length} number(s) activated. ${(rejectedNumbers?.length || 0)} rejected.`,
            data: onboarding
        });

    } catch (error) {
        return handleError(res, error, "Failed to approve connection request");
    }
};

/* =====================================================
   ADMIN — Reject entire request
   PATCH /api/whatsapp/onboarding/:id/reject
===================================================== */
export const rejectConnectionRequest = async (req, res) => {
    try {
        const adminId = getUserId(req);
        const { id } = req.params;
        const { rejectionReason, adminNotes } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id))
            return res.status(400).json({ success: false, message: "Invalid ID" });

        const onboarding = await WhatsappOnboarding.findById(id);

        if (!onboarding)
            return res.status(404).json({ success: false, message: "Onboarding request not found" });

        if (onboarding.connectionStatus === "APPROVED") {
            return res.status(400).json({
                success: false,
                message: "Cannot reject an already approved request"
            });
        }

        // Mark all numbers as rejected
        onboarding.whatsappNumbers = onboarding.whatsappNumbers.map((entry) => ({
            ...entry,
            status: "REJECTED",
            rejectionReason: rejectionReason || null
        }));

        onboarding.connectionStatus = "REJECTED";
        onboarding.reviewedBy = adminId;
        onboarding.reviewedAt = new Date();
        onboarding.rejectionReason = rejectionReason || null;
        onboarding.adminNotes = adminNotes || null;

        await onboarding.save();

        return res.status(200).json({
            success: true,
            message: "Connection request rejected.",
            data: onboarding
        });

    } catch (error) {
        return handleError(res, error, "Failed to reject connection request");
    }
};

/* =====================================================
   USER — Get own onboarding requests
   GET /api/whatsapp/onboarding
===================================================== */
export const getMyOnboardingRequests = async (req, res) => {
    try {
        const userId = getUserId(req);

        if (!userId)
            return res.status(401).json({ success: false, message: "Unauthorized" });

        const { status, page = 1, limit = 20 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const filter = { userId };
        if (status) filter.connectionStatus = status;

        const [requests, total] = await Promise.all([
            WhatsappOnboarding.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .lean(),
            WhatsappOnboarding.countDocuments(filter)
        ]);

        return res.status(200).json({
            success: true,
            pagination: {
                totalRecords: total,
                currentPage: Number(page),
                totalPages: Math.ceil(total / Number(limit)),
                pageSize: Number(limit)
            },
            data: requests
        });

    } catch (error) {
        return handleError(res, error, "Failed to fetch onboarding requests");
    }
};

/* =====================================================
   USER — Get single onboarding request
   GET /api/whatsapp/onboarding/:id
===================================================== */
export const getOnboardingRequestById = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id))
            return res.status(400).json({ success: false, message: "Invalid ID" });

        const request = await WhatsappOnboarding.findOne({ _id: id, userId }).lean();

        if (!request)
            return res.status(404).json({ success: false, message: "Onboarding request not found" });

        return res.status(200).json({ success: true, data: request });

    } catch (error) {
        return handleError(res, error, "Failed to fetch request");
    }
};

/* =====================================================
   ADMIN — Get all requests (filterable by status)
   GET /api/whatsapp/onboarding/admin/all
   ?status=SUBMITTED&page=1&limit=20
===================================================== */
export const getAllOnboardingRequests = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const filter = {};
        if (status) filter.connectionStatus = status;

        const [requests, total] = await Promise.all([
            WhatsappOnboarding.find(filter)
                .populate("userId", "name email phone")
                .populate("reviewedBy", "name email")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .lean(),
            WhatsappOnboarding.countDocuments(filter)
        ]);

        return res.status(200).json({
            success: true,
            pagination: {
                totalRecords: total,
                currentPage: Number(page),
                totalPages: Math.ceil(total / Number(limit)),
                pageSize: Number(limit)
            },
            data: requests
        });

    } catch (error) {
        return handleError(res, error, "Failed to fetch all requests");
    }
};

/* =====================================================
   GET WHATSAPP ACTIVATION NUMBERS
   GET /api/whatsapp/activation
   Returns approved numbers for the logged-in user
===================================================== */
export const getWhatsappActivation = async (req, res) => {
    try {
        const userId = getUserId(req);

        if (!userId)
            return res.status(401).json({ success: false, message: "Unauthorized" });

        const numbers = await WhatsappActivation.find(
            { userId, isActive: true },
            { integrated_number: 1, createdAt: 1, _id: 1 }
        ).lean();

        return res.status(200).json({
            success: true,
            message: "WhatsApp activation fetched successfully",
            data: numbers
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch WhatsApp activation",
            error: error.message
        });
    }
};