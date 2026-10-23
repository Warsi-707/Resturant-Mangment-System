import { z } from 'zod';

const portionSchema = z.object({
  label: z.string().trim().min(1, 'Portion label cannot be empty').max(50),
  quantityInBaseUnit: z.number().positive('Portion quantity must be greater than 0'),
  price: z.number().nonnegative('Portion price cannot be negative').optional(),
});

export const createItemSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(1, 'Item name is required').max(150, 'Name must be 150 characters or less'),
  categoryId: z.string().trim().min(1, 'Category ID is required'),
  categoryName: z.string().trim().optional(),
  description: z.string().trim().max(500, 'Description cannot exceed 500 characters').optional().default(''),
  imageRef: z.string().trim().optional().default(''),
  status: z.enum(['active', 'inactive']).default('active').optional(),
  basePrice: z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return undefined;
    const num = Number(val);
    return isNaN(num) ? val : num;
  }, z.number().min(0, 'Base price must be a non-negative number')).optional(),
  price: z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return undefined;
    const num = Number(val);
    return isNaN(num) ? val : num;
  }, z.number().min(0)).optional(),
  costPrice: z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return null;
    const num = Number(val);
    return isNaN(num) ? val : num;
  }, z.number().min(0, 'Cost price must be a non-negative number').nullable()).optional(),
  unitType: z.enum(['weight', 'piece', 'plate', 'volume', 'custom']).default('piece').optional(),
  baseUnit: z.string().trim().max(30).default('piece').optional(),
  unit: z.string().trim().max(50).default('Piece').optional(),
  portionOptions: z.array(portionSchema).default([]).optional(),
  addonIds: z.array(z.string().trim()).default([]).optional(),
}).passthrough().transform((data) => {
  if (data.basePrice === undefined && data.price !== undefined) {
    data.basePrice = data.price;
  }
  if (data.basePrice === undefined) {
    data.basePrice = 0;
  }
  return data;
});

export const updateItemSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  categoryId: z.string().trim().min(1).optional(),
  categoryName: z.string().trim().optional(),
  description: z.string().trim().max(500).optional(),
  imageRef: z.string().trim().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  basePrice: z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return undefined;
    const num = Number(val);
    return isNaN(num) ? val : num;
  }, z.number().min(0)).optional(),
  price: z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return undefined;
    const num = Number(val);
    return isNaN(num) ? val : num;
  }, z.number().min(0)).optional(),
  costPrice: z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return null;
    const num = Number(val);
    return isNaN(num) ? val : num;
  }, z.number().min(0).nullable()).optional(),
  unitType: z.enum(['weight', 'piece', 'plate', 'volume', 'custom']).optional(),
  baseUnit: z.string().trim().max(30).optional(),
  unit: z.string().trim().max(50).optional(),
  portionOptions: z.array(portionSchema).optional(),
  addonIds: z.array(z.string().trim()).optional(),
}).passthrough().transform((data) => {
  if (data.basePrice === undefined && data.price !== undefined) {
    data.basePrice = data.price;
  }
  return data;
});

/**
 * Express middleware to validate request bodies against a Zod schema
 */
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
