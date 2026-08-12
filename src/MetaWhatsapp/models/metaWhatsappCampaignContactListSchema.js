import mongoose from "mongoose";

const contactListSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        name: { type: String, required: true, trim: true },
        description: { type: String, default: "" },
        contactIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Contact" }],
        contactCount: { type: Number, default: 0 },
        source: { type: String, enum: ["manual", "import", "api"], default: "manual" },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

contactListSchema.index({ userId: 1 });

contactListSchema.pre("save", function (next) {
    this.contactCount = this.contactIds.length;
    next();
});

contactListSchema.methods.addContacts = async function (ids = []) {
    const set = new Set(this.contactIds.map(String));
    ids.forEach((id) => set.add(String(id)));
    this.contactIds = [...set];
    this.contactCount = this.contactIds.length;
    return this.save();
};

contactListSchema.methods.removeContacts = async function (ids = []) {
    const remove = new Set(ids.map(String));
    this.contactIds = this.contactIds.filter((id) => !remove.has(String(id)));
    this.contactCount = this.contactIds.length;
    return this.save();
};

export default mongoose.model("WhatsappContactList", contactListSchema);