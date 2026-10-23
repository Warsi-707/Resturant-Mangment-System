import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      default: 'invoice_delete',
    },
    title: {
      type: String,
      default: '',
    },
    deletedAt: {
      type: String,
      default: () => new Date().toISOString(),
    },
    reason: {
      type: String,
      default: '',
    },
    totalInvoicesDeleted: {
      type: Number,
      default: 1,
    },
    totalAmount: {
      type: Number,
      default: 0,
    },
    invoices: {
      type: Array,
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
export default AuditLog;
