import mongoose from 'mongoose';

const metaWhatsappTemplateLibrarySchema = new mongoose.Schema(
  {
    libraryId: { type: String, unique: true, sparse: true },
    title: { type: String },
    description: { type: String },
    category: {
      type: String,
      required: true,
    },
    topic: {
      type: String,
      default: 'ECOMMERCE',
    },
    language: { type: String, default: 'en_US' },
    header: { type: mongoose.Schema.Types.Mixed },
    body: { type: String, required: true },
    footer: { type: String, default: '' },
    buttons: [mongoose.Schema.Types.Mixed],
    sampleVariables: { type: mongoose.Schema.Types.Mixed },
    tags: [String],
    isOfficial: { type: Boolean, default: true },
    
    // Additional fields returned by Meta's Graph API
    name: { type: String },
    usecase: { type: String },
    industry: [String],
    body_params: [mongoose.Schema.Types.Mixed],
    body_param_types: [mongoose.Schema.Types.Mixed],
  },
  { timestamps: true }
);

const TemplateLibrary = mongoose.model(
  'MetaWhatsappTemplateLibrary',
  metaWhatsappTemplateLibrarySchema
);

export default TemplateLibrary;
