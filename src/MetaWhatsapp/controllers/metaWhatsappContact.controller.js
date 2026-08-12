
import Contact from "../models/metaWhatsappCampaignContactsSchema.js";
import ContactList from "../models/metaWhatsappCampaignContactListSchema.js";
import logger from "../../config/logger.js";
import mongoose from "mongoose";

const getPagination = (query) => {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
    const skip = (page - 1) * limit;
    return { page, limit, skip };
};

// ════════════════════════════════════ CONTACTS ════════════════════════════════

export const getContacts = async (req, res, next) => {
    try {
        const { search, tag, optedOut } = req.query;
        const { page, limit, skip } = getPagination(req.query);

        console.log(req.user.id, "req.user.id");

        // ✅ Add isDeleted filter here
        const filter = { 
            userId: req.user.id,
            isDeleted: { $ne: true } // skip deleted contacts
        };

        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: "i" } },
                { phone: { $regex: search } },
                { email: { $regex: search, $options: "i" } },
            ];
        }

        if (tag) filter.tags = tag;

        if (optedOut !== undefined) {
            filter.optedOut = optedOut === "true";
        }

        const [contacts, total] = await Promise.all([
            Contact.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Contact.countDocuments(filter),
        ]);

        console.log("contacts", contacts);

        res.json({
            success: true,
            data: contacts,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        next(err);
    }
};

export const getContactById = async (req, res, next) => {
    try {
        const contact = await Contact.findOne({ _id: req.params.id, userId: req.user.id, isDeleted: false });
        if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
        res.json({ success: true, data: contact });
    } catch (err) {
        next(err);
    }
};

export const createContact = async (req, res, next) => {
    try {
        const { phone, name, email, tags, customFields } = req.body;

        const contact = await Contact.create({
            userId: req.user.id,
            phone,
            name: name || "",
            email: email || null,
            tags: tags || [],
            customFields: customFields || {},
            source: "manual",
        });

        res.status(201).json({ success: true, data: contact });
    } catch (err) {
        next(err);
    }
};

export const bulkImportContacts = async (req, res, next) => {
    try {
        const { contacts } = req.body;
        if (!Array.isArray(contacts) || contacts.length === 0) {
            return res.status(400).json({ success: false, message: "contacts array is required" });
        }

        const ops = contacts.map((c) => ({
            updateOne: {
                filter: { userId: req.user.id, phone: c.phone },
                update: {
                    $set: {
                        userId: req.user.id,
                        phone: c.phone,
                        name: c.name || "",
                        email: c.email || null,
                        tags: c.tags || [],
                        customFields: c.customFields || {},
                        source: "import",
                        isDeleted: false,
                    },
                },
                upsert: true,
            },
        }));

        const result = await Contact.bulkWrite(ops, { ordered: false });
        res.status(201).json({
            success: true,
            message: `Imported: ${result.upsertedCount} new, ${result.modifiedCount} updated`,
            data: { upserted: result.upsertedCount, modified: result.modifiedCount },
        });
    } catch (err) {
        next(err);
    }
};

export const updateContact = async (req, res, next) => {
    try {
        const { name, email, tags, customFields, optedOut } = req.body;
        const contact = await Contact.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id, isDeleted: false },
            {
                $set: {
                    ...(name !== undefined && { name }),
                    ...(email !== undefined && { email }),
                    ...(tags !== undefined && { tags }),
                    ...(customFields !== undefined && { customFields }),
                    ...(optedOut !== undefined && { optedOut, optedOutAt: optedOut ? new Date() : null }),
                },
            },
            { new: true }
        );
        if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
        res.json({ success: true, data: contact });
    } catch (err) {
        next(err);
    }
};

export const deleteContact = async (req, res, next) => {
    try {
        console.log(req.params.id, req.user.id, "user details");
        const contact = await Contact.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id, isDeleted: false },
            { isDeleted: true, deletedAt: new Date() },
            { new: true }
        );
        console.log(contact,  "contact deleted");
        if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
        res.json({ success: true, message: "Contact deleted" });
    } catch (err) {
        next(err);
    }
};

// ════════════════════════════════ CONTACT LISTS ═══════════════════════════════
export const getContactLists = async (req, res, next) => {
    try {
        const { page, limit, skip } = getPagination(req.query);

        const filter = {
            userId: new mongoose.Types.ObjectId(req.user.id)
        };

        const [lists, total] = await Promise.all([
            ContactList.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),

            ContactList.countDocuments(filter)
        ]);

        res.json({
            success: true,
            data: lists,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (err) {
        next(err);
    }
};

export const getContactListById = async (req, res, next) => {
    try {
        const list = await ContactList.findOne({ _id: req.params.id, userId: req.user.id, isDeleted: false })
            .populate({ path: "contactIds", match: { isDeleted: false }, select: "phone name email tags optedOut" });
        if (!list) return res.status(404).json({ success: false, message: "List not found" });
        res.json({ success: true, data: list });
    } catch (err) {
        next(err);
    }
};

export const createContactList = async (req, res, next) => {
    try {
        const { name, description, contactIds } = req.body;
        const list = await ContactList.create({
            userId: req.user.id,
            name,
            description: description || "",
            contactIds: contactIds || [],
            source: "manual",
        });
        res.status(201).json({ success: true, data: list });
    } catch (err) {
        next(err);
    }
};

export const addContactsToList = async (req, res, next) => {
    try {
        const { contactIds } = req.body;
        const list = await ContactList.findOne({ _id: req.params.id, userId: req.user.id, isDeleted: false });
        if (!list) return res.status(404).json({ success: false, message: "List not found" });
        await list.addContacts(contactIds);
        res.json({ success: true, message: `${contactIds.length} contacts added`, data: list });
    } catch (err) {
        next(err);
    }
};

export const removeContactsFromList = async (req, res, next) => {
    try {
        const { contactIds } = req.body;
        const list = await ContactList.findOne({ _id: req.params.id, userId: req.user.id, isDeleted: false });
        if (!list) return res.status(404).json({ success: false, message: "List not found" });
        await list.removeContacts(contactIds);
        res.json({ success: true, message: "Contacts removed", data: list });
    } catch (err) {
        next(err);
    }
};

export const deleteContactList = async (req, res, next) => {
    try {
        const list = await ContactList.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id, isDeleted: false },
            { isDeleted: true, deletedAt: new Date() },
            { new: true }
        );
        if (!list) return res.status(404).json({ success: false, message: "List not found" });
        res.json({ success: true, message: "List deleted" });
    } catch (err) {
        next(err);
    }
};