import { User } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      waCredentials?: {
        phoneNumberId: string;
        accessToken: string;
      };
      apiKeyDoc?: any;
    }
  }
}
