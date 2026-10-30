// Fields the auth middleware adds to every signed-in request.
import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string, username: string, display_name: string, role: string, email?: string, avatar?: string, notify_email?: number, [k: string]: any };
    who?: { id: string | null, name: string };
    touchedBoards?: Set<string>;
  }
}
