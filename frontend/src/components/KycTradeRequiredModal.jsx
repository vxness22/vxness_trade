import { X, ShieldAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

/**
 * Shown when the user tries to open trading without admin-approved KYC.
 */
export default function KycTradeRequiredModal({ open, onClose, isDarkMode = true }) {
  const navigate = useNavigate()

  if (!open) return null

  const goToProfile = () => {
    onClose()
    navigate('/profile', { state: { scrollToKyc: true } })
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-sm border-0 cursor-default"
        aria-label="Close dialog backdrop"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kyc-trade-modal-title"
        className={`relative w-full max-w-[420px] rounded-2xl border shadow-2xl overflow-hidden ${
          isDarkMode
            ? 'bg-[#0d0d0d] border-gray-700/80'
            : 'bg-white border-gray-200 shadow-xl'
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-3 right-3 p-2 rounded-lg transition-colors z-10 ${
            isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-white/10'
              : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
          }`}
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="px-6 pt-10 pb-6 sm:px-8 sm:pb-8">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
            <ShieldAlert className="w-8 h-8 text-amber-400" strokeWidth={1.75} />
          </div>

          <h2
            id="kyc-trade-modal-title"
            className={`text-center text-xl font-bold tracking-tight ${
              isDarkMode ? 'text-white' : 'text-gray-900'
            }`}
          >
            Trade terminal locked
          </h2>

          <p
            className={`text-center text-sm leading-relaxed mt-3 ${
              isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}
          >
            Complete identity verification (KYC) and wait for an administrator to approve it. After
            approval, you can use the trade terminal and place orders.
          </p>

          <div className="mt-8 space-y-3">
            <button
              type="button"
              onClick={goToProfile}
              className="w-full py-3.5 rounded-xl font-semibold text-[#0a0a0a] bg-[#3B82F6] hover:bg-[#2563EB] active:scale-[0.99] transition-all shadow-lg shadow-blue-500/20"
            >
              Go to profile &amp; KYC
            </button>
            <button
              type="button"
              onClick={onClose}
              className={`w-full py-3 rounded-xl font-medium transition-colors ${
                isDarkMode
                  ? 'text-gray-300 bg-white/5 hover:bg-white/10 border border-gray-700'
                  : 'text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
