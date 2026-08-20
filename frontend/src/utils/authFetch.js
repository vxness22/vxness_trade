// Headers for the trading endpoints that now require a verified session.
//
// /api/trade/open, /close, /modify and /cancel used to take userId and
// tradingAccountId from the request body and trust them. They now derive the
// user from this token instead (backend utils/webAuth.js), so every call that
// changes a position has to carry it or the server answers 401.
//
// The token is what routes/auth.js issued at login and Login.jsx stored.

export function authHeaders(extra) {
  const token = localStorage.getItem('token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  }
}

// True when a response was rejected for a missing/expired session, so callers
// can tell the trader to sign in again rather than showing a generic failure.
export function isAuthFailure(res, data) {
  if (res && (res.status === 401 || res.status === 403)) return true
  const code = data && data.code
  return code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID' ||
         code === 'NOT_YOUR_ACCOUNT' || code === 'NOT_YOUR_TRADE'
}
