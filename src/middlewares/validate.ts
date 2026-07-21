import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export const validateRequest = (schema: any) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: {
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: (error as any).errors || (error as any).issues,
          },
        });
      }
      return next(error);
    }
  };
};
