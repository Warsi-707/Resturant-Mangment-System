import { z } from 'zod';

export const updateSettingsSchema = z.object({
  businessName: z.string().trim().min(1).max(150).optional(),
  tagline: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  address: z.string().trim().max(300).optional(),
  ntn: z.string().trim().max(50).optional(),
  defaultTaxRate: z.number().min(0).max(100).optional(),
  isTaxEnabled: z.boolean().optional(),
  invoicePrefix: z.string().trim().max(10).optional(),
  footerNote: z.string().trim().max(300).optional(),
  currencySymbol: z.string().trim().max(10).optional(),
  logo: z.string().optional(),
});

export const dangerZoneResetSchema = z.object({
  confirmationPhrase: z.literal('DELETE ALL DATA', {
    errorMap: () => ({ message: "Must match exact phrase 'DELETE ALL DATA'" }),
  }),
  resetType: z.string().optional(),
});

export function validate(schema) {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req.body);
      req.body = parsed;
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Validation failed',
            details: err.errors.map((e) => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          },
        });
      }
      next(err);
    }
  };
}
