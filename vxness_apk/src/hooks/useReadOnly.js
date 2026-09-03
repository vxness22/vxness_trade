import { useContext } from 'react';
import { AuthContext } from '../app/providers/AuthContext';

/**
 * True when the session came from an investor (view-only) sign-in.
 *
 * This is for presentation only — what to hide or grey out. The actual refusal
 * lives on the server, which rejects every non-GET on an investor token (see
 * jwtAuth in backend/utils/terminalAuth.js). Treat a missed button here as a
 * cosmetic bug, never as a way in: the request still fails.
 */
export default function useReadOnly() {
  const auth = useContext(AuthContext) || {};
  return !!auth.isInvestor;
}
