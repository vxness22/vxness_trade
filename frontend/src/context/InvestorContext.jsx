import { createContext, useContext, useState, useEffect } from 'react'

const InvestorContext = createContext()

export const InvestorProvider = ({ children }) => {
  const [isInvestorMode, setIsInvestorMode] = useState(false)

  useEffect(() => {
    const checkInvestorMode = () => {
      const investorMode = localStorage.getItem('investorMode') === 'true'
      setIsInvestorMode(investorMode)
    }
    
    checkInvestorMode()
    
    // Listen for storage changes
    window.addEventListener('storage', checkInvestorMode)
    return () => window.removeEventListener('storage', checkInvestorMode)
  }, [])

  return (
    <InvestorContext.Provider value={{ isInvestorMode, setIsInvestorMode }}>
      {children}
    </InvestorContext.Provider>
  )
}

export const useInvestor = () => {
  const context = useContext(InvestorContext)
  if (!context) {
    throw new Error('useInvestor must be used within InvestorProvider')
  }
  return context
}

export default InvestorContext
