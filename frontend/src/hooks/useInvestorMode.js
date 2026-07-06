// Hook to check if user is in investor mode (read-only)
export const useInvestorMode = () => {
  const isInvestorMode = sessionStorage.getItem('investorMode') === 'true'
  const investorAccount = isInvestorMode 
    ? JSON.parse(sessionStorage.getItem('investorAccount') || '{}') 
    : null
  const investorUser = investorAccount?.user || null

  return {
    isInvestorMode,
    investorAccount,
    investorUser
  }
}

// CSS string to inject for read-only mode
export const investorReadOnlyCSS = `
  .investor-action-disabled button:not(.allow-investor),
  .investor-action-disabled input:not(.allow-investor),
  .investor-action-disabled select:not(.allow-investor),
  .investor-action-disabled textarea:not(.allow-investor),
  .investor-action-disabled [role="button"]:not(.allow-investor) {
    pointer-events: none !important;
    opacity: 0.6 !important;
    cursor: not-allowed !important;
  }
  .investor-action-disabled a:not(.allow-investor) {
    pointer-events: none !important;
  }
`

export default useInvestorMode
