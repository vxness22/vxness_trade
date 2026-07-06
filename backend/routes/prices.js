import dotenv from 'dotenv'
dotenv.config()
import express from 'express'
import infowayService, { SUPPORTED_SYMBOLS, CRYPTO_SYMBOLS, FALLBACK_PRICES } from '../services/infowayService.js'

const router = express.Router()


const SYMBOL_MAP = SUPPORTED_SYMBOLS.reduce((acc, s) => { acc[s] = s; return acc }, {})

// Popular instruments per category (shown by default - 15 max)
const POPULAR_INSTRUMENTS = {
  Forex: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD', 'EURGBP', 'EURJPY', 'GBPJPY', 'EURCHF', 'EURAUD', 'AUDCAD', 'AUDJPY', 'CADJPY'],
  Metals: ['XAUUSD', 'XAGUSD', 'XPTUSD', 'XPDUSD'],
  Commodities: ['USOIL', 'UKOIL', 'NGAS', 'COPPER'],
  Crypto: ['BTCUSD', 'ETHUSD', 'BNBUSD', 'SOLUSD', 'XRPUSD', 'ADAUSD', 'DOGEUSD', 'DOTUSD', 'MATICUSD', 'LTCUSD', 'AVAXUSD', 'LINKUSD', 'SHIBUSD', 'UNIUSD', 'ATOMUSD']
}

// Fetch price from Infoway with fallback
async function getLpPrice(symbol) {
  try {
    if (!SYMBOL_MAP[symbol]) {
      return FALLBACK_PRICES[symbol] || null
    }
    const price = infowayService.getPrice(symbol)
    return price || FALLBACK_PRICES[symbol] || null
  } catch (e) {
    return FALLBACK_PRICES[symbol] || null
  }
}

// Helper function to categorize symbols (must align with Charges.segment: Forex, Metals, Crypto, Indices, Commodities)
function categorizeSymbol(symbol) {
  if (!symbol) return 'Forex'
  const s = symbol.toUpperCase()
  if (s.includes('XAU') || s.includes('XAG') || s.includes('XPT') || s.includes('XPD')) {
    return 'Metals'
  }
  if (s.includes('OIL') || s.includes('BRENT') || s.includes('WTI') || s === 'NGAS' || s === 'COPPER') {
    return 'Commodities'
  }
  if (infowayService.isCrypto(symbol)) {
    return 'Crypto'
  }
  const indexSymbols = ['US30', 'US500', 'NAS100', 'SPX500', 'GER40', 'UK100', 'USTEC', 'DE30', 'DJ30', 'US100']
  if (indexSymbols.includes(s)) return 'Indices'
  return 'Forex'
}

// Helper function to get crypto names
function getCryptoName(symbol) {
  const names = {
    'BTCUSD': 'Bitcoin',
    'ETHUSD': 'Ethereum',
    'BNBUSD': 'BNB',
    'SOLUSD': 'Solana',
    'XRPUSD': 'XRP',
    'ADAUSD': 'Cardano',
    'DOGEUSD': 'Dogecoin',
    'DOTUSD': 'Polkadot',
    'MATICUSD': 'Polygon',
    'LTCUSD': 'Litecoin',
    'AVAXUSD': 'Avalanche',
    'LINKUSD': 'Chainlink'
  }
  return names[symbol] || symbol
}

// Default instruments fallback
function getDefaultInstruments() {
  return [
    { symbol: 'EURUSD', name: 'EUR/USD', category: 'Forex', digits: 5 },
    { symbol: 'GBPUSD', name: 'GBP/USD', category: 'Forex', digits: 5 },
    { symbol: 'USDJPY', name: 'USD/JPY', category: 'Forex', digits: 3 },
    { symbol: 'USDCHF', name: 'USD/CHF', category: 'Forex', digits: 5 },
    { symbol: 'AUDUSD', name: 'AUD/USD', category: 'Forex', digits: 5 },
    { symbol: 'NZDUSD', name: 'NZD/USD', category: 'Forex', digits: 5 },
    { symbol: 'USDCAD', name: 'USD/CAD', category: 'Forex', digits: 5 },
    { symbol: 'EURGBP', name: 'EUR/GBP', category: 'Forex', digits: 5 },
    { symbol: 'EURJPY', name: 'EUR/JPY', category: 'Forex', digits: 3 },
    { symbol: 'GBPJPY', name: 'GBP/JPY', category: 'Forex', digits: 3 },
    { symbol: 'XAUUSD', name: 'Gold', category: 'Metals', digits: 2 },
    { symbol: 'XAGUSD', name: 'Silver', category: 'Metals', digits: 3 },
    { symbol: 'BTCUSD', name: 'Bitcoin', category: 'Crypto', digits: 2 },
    { symbol: 'ETHUSD', name: 'Ethereum', category: 'Crypto', digits: 2 },
  ]
}

// GET /api/prices/instruments - Get all available instruments (MUST be before /:symbol)
router.get('/instruments', async (req, res) => {
  try {
    console.log('Returning Infoway supported instruments')
    
    const instruments = SUPPORTED_SYMBOLS.map(symbol => {
      const category = categorizeSymbol(symbol)
      const isPopular = POPULAR_INSTRUMENTS[category]?.includes(symbol) || false
      return {
        symbol,
        name: getInstrumentName(symbol),
        category,
        digits: getDigits(symbol),
        contractSize: getContractSize(symbol),
        minVolume: 0.01,
        maxVolume: 100,
        volumeStep: 0.01,
        popular: isPopular
      }
    })
    
    console.log('Returning', instruments.length, 'Infoway instruments')
    res.json({ success: true, instruments })
  } catch (error) {
    console.error('Error fetching instruments:', error)
    res.json({ success: true, instruments: getDefaultInstruments() })
  }
})

// Helper to get instrument display name
function getInstrumentName(symbol) {
  const names = {
    // Forex Majors & Crosses
    'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD', 'USDJPY': 'USD/JPY', 'USDCHF': 'USD/CHF',
    'AUDUSD': 'AUD/USD', 'NZDUSD': 'NZD/USD', 'USDCAD': 'USD/CAD', 'EURGBP': 'EUR/GBP',
    'EURJPY': 'EUR/JPY', 'GBPJPY': 'GBP/JPY', 'EURCHF': 'EUR/CHF', 'EURAUD': 'EUR/AUD',
    'EURCAD': 'EUR/CAD', 'GBPAUD': 'GBP/AUD', 'GBPCAD': 'GBP/CAD', 'AUDCAD': 'AUD/CAD',
    'AUDJPY': 'AUD/JPY', 'CADJPY': 'CAD/JPY', 'CHFJPY': 'CHF/JPY', 'NZDJPY': 'NZD/JPY',
    'AUDNZD': 'AUD/NZD', 'CADCHF': 'CAD/CHF', 'GBPCHF': 'GBP/CHF', 'GBPNZD': 'GBP/NZD',
    'EURNZD': 'EUR/NZD', 'NZDCAD': 'NZD/CAD', 'NZDCHF': 'NZD/CHF', 'AUDCHF': 'AUD/CHF',
    'EURSGD': 'EUR/SGD', 'USDSGD': 'USD/SGD', 'GBPSGD': 'GBP/SGD', 'AUDSGD': 'AUD/SGD',
    'SGDJPY': 'SGD/JPY', 'USDHKD': 'USD/HKD', 'USDZAR': 'USD/ZAR', 'EURZAR': 'EUR/ZAR',
    'GBPZAR': 'GBP/ZAR', 'ZARJPY': 'ZAR/JPY', 'USDTRY': 'USD/TRY', 'EURTRY': 'EUR/TRY',
    'TRYJPY': 'TRY/JPY', 'USDMXN': 'USD/MXN', 'EURMXN': 'EUR/MXN', 'MXNJPY': 'MXN/JPY',
    'USDPLN': 'USD/PLN', 'EURPLN': 'EUR/PLN', 'GBPPLN': 'GBP/PLN', 'USDSEK': 'USD/SEK',
    'EURSEK': 'EUR/SEK', 'GBPSEK': 'GBP/SEK', 'SEKJPY': 'SEK/JPY', 'USDNOK': 'USD/NOK',
    'EURNOK': 'EUR/NOK', 'GBPNOK': 'GBP/NOK', 'NOKJPY': 'NOK/JPY', 'USDDKK': 'USD/DKK',
    'EURDKK': 'EUR/DKK', 'DKKJPY': 'DKK/JPY', 'USDCNH': 'USD/CNH', 'CNHJPY': 'CNH/JPY',
    'USDHUF': 'USD/HUF', 'EURHUF': 'EUR/HUF', 'USDCZK': 'USD/CZK', 'EURCZK': 'EUR/CZK',
    // Metals
    'XAUUSD': 'Gold', 'XAGUSD': 'Silver', 'XPTUSD': 'Platinum', 'XPDUSD': 'Palladium',
    'XAUEUR': 'Gold/EUR', 'XAUGBP': 'Gold/GBP', 'XAUAUD': 'Gold/AUD', 'XAUCHF': 'Gold/CHF',
    'XAUJPY': 'Gold/JPY', 'XAUCAD': 'Gold/CAD', 'XAUNZD': 'Gold/NZD',
    'XAGEUR': 'Silver/EUR', 'XAGGBP': 'Silver/GBP', 'XAGAUD': 'Silver/AUD', 'XAGCHF': 'Silver/CHF',
    'XAGJPY': 'Silver/JPY', 'XAGCAD': 'Silver/CAD', 'XAGNZD': 'Silver/NZD',
    // Commodities
    'USOIL': 'US Oil', 'UKOIL': 'UK Oil', 'NGAS': 'Natural Gas', 'COPPER': 'Copper',
    'ALUMINUM': 'Aluminum', 'NICKEL': 'Nickel',
    // Crypto
    'BTCUSD': 'Bitcoin', 'ETHUSD': 'Ethereum', 'BNBUSD': 'BNB', 'SOLUSD': 'Solana',
    'XRPUSD': 'XRP', 'ADAUSD': 'Cardano', 'DOGEUSD': 'Dogecoin', 'TRXUSD': 'TRON',
    'LINKUSD': 'Chainlink', 'MATICUSD': 'Polygon', 'DOTUSD': 'Polkadot',
    'SHIBUSD': 'Shiba Inu', 'LTCUSD': 'Litecoin', 'BCHUSD': 'Bitcoin Cash', 'AVAXUSD': 'Avalanche',
    'XLMUSD': 'Stellar', 'UNIUSD': 'Uniswap', 'ATOMUSD': 'Cosmos', 'ETCUSD': 'Ethereum Classic',
    'FILUSD': 'Filecoin', 'ICPUSD': 'Internet Computer', 'VETUSD': 'VeChain',
    'NEARUSD': 'NEAR Protocol', 'GRTUSD': 'The Graph', 'AAVEUSD': 'Aave', 'MKRUSD': 'Maker',
    'ALGOUSD': 'Algorand', 'FTMUSD': 'Fantom', 'SANDUSD': 'The Sandbox', 'MANAUSD': 'Decentraland',
    'AXSUSD': 'Axie Infinity', 'THETAUSD': 'Theta Network', 'XMRUSD': 'Monero', 'FLOWUSD': 'Flow',
    'SNXUSD': 'Synthetix', 'EOSUSD': 'EOS', 'CHZUSD': 'Chiliz', 'ENJUSD': 'Enjin Coin',
    'ZILUSD': 'Zilliqa', 'BATUSD': 'Basic Attention Token', 'CRVUSD': 'Curve DAO', 'COMPUSD': 'Compound',
    'SUSHIUSD': 'SushiSwap', 'ZRXUSD': '0x', 'LRCUSD': 'Loopring', 'ANKRUSD': 'Ankr',
    'GALAUSD': 'Gala', 'APEUSD': 'ApeCoin', 'WAVESUSD': 'Waves', 'ZECUSD': 'Zcash',
    // More crypto names
    'PEPEUSD': 'Pepe', 'ARBUSD': 'Arbitrum', 'OPUSD': 'Optimism', 'SUIUSD': 'Sui',
    'APTUSD': 'Aptos', 'INJUSD': 'Injective', 'LDOUSD': 'Lido DAO', 'IMXUSD': 'Immutable X',
    'RUNEUSD': 'THORChain', 'KAVAUSD': 'Kava', 'KSMUSD': 'Kusama', 'NEOUSD': 'NEO',
    'QNTUSD': 'Quant', 'FETUSD': 'Fetch.ai', 'RNDRUSD': 'Render', 'OCEANUSD': 'Ocean Protocol',
    'WLDUSD': 'Worldcoin', 'SEIUSD': 'Sei', 'TIAUSD': 'Celestia', 'BLURUSD': 'Blur',
    'ROSEUSD': 'Oasis Network', 'MINAUSD': 'Mina Protocol', 'GMXUSD': 'GMX', 'DYDXUSD': 'dYdX',
    'STXUSD': 'Stacks', 'CFXUSD': 'Conflux', 'ACHUSD': 'Alchemy Pay', 'DASHUSD': 'Dash',
    'XTZUSD': 'Tezos', 'IOTUSD': 'IOTA', 'CELOUSD': 'Celo', 'ONEUSD': 'Harmony',
    'HOTUSD': 'Holo', 'SKLUSD': 'SKALE', 'STORJUSD': 'Storj', 'YFIUSD': 'yearn.finance',
    'UMAUSD': 'UMA', 'BANDUSD': 'Band Protocol', 'RVNUSD': 'Ravencoin', 'OXTUSD': 'Orchid',
    'NKNUSD': 'NKN', 'WOOUSD': 'WOO Network', 'AABORUSD': 'SingularityNET', 'JASMYUSD': 'JasmyCoin',
    'MASKUSD': 'Mask Network', 'DENTUSD': 'Dent', 'CELRUSD': 'Celer Network', 'COTIUSD': 'COTI',
    'CTSIUSD': 'Cartesi', 'IOTXUSD': 'IoTeX', 'KLAYUSD': 'Klaytn', 'OGNUSD': 'Origin Protocol',
    'RLCUSD': 'iExec RLC', 'STMXUSD': 'StormX', 'SUNUSD': 'Sun Token', 'SXPUSD': 'Solar',
    'WINUSD': 'WINkLink', 'AKROUSD': 'Akropolis', 'AUDIOUSD': 'Audius', 'BELUSD': 'Bella Protocol',
    'BONKUSD': 'Bonk', 'FLOKIUSD': 'Floki', 'JTUSD': 'JTO', 'ORDIUSD': 'ORDI',
    'PENDUSD': 'Pendle', 'RADUSD': 'Radicle', 'RDNTUSD': 'Radiant Capital', 'RPLUSD': 'Rocket Pool',
    'SSVUSD': 'ssv.network', 'WAXUSD': 'WAX', 'XECUSD': 'eCash', 'ZENUSD': 'Horizen',
    '1INCHUSD': '1inch', 'HBARUSD': 'Hedera', 'TONUSD': 'Toncoin', 'EGLDUSD': 'MultiversX'
  }
  return names[symbol] || symbol
}

// Helper to get digits for symbol
function getDigits(symbol) {
  if (symbol.includes('JPY')) return 3
  if (symbol === 'XAUUSD' || symbol === 'XAGUSD') return 2
  if (infowayService.isCrypto(symbol)) return 2
  return 5
}

// Helper to get contract size
function getContractSize(symbol) {
  if (infowayService.isCrypto(symbol)) return 1
  if (symbol === 'XAUUSD' || symbol === 'XAGUSD') return 100
  return 100000
}

// GET /api/prices/status - Live/frozen state of the Infoway price feed (MUST be before /:symbol)
router.get('/status', (req, res) => {
  try {
    res.json({ success: true, status: infowayService.getFeedStatus() })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/prices/:symbol - Get single symbol price
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params

    // Check if symbol is supported
    if (!SYMBOL_MAP[symbol]) {
      return res.status(404).json({ success: false, message: `Symbol ${symbol} not supported` })
    }
    
    // Use cached price from infowayService (live WebSocket data)
    const price = infowayService.getPrice(symbol)
    
    if (price) {
      res.json({ success: true, price })
    } else {
      res.status(404).json({ success: false, message: 'Price not available' })
    }
  } catch (error) {
    console.error('Error fetching price:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/prices/batch - Get multiple symbol prices from cache
router.post('/batch', async (req, res) => {
  try {
    const { symbols } = req.body
    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ success: false, message: 'symbols array required' })
    }
    
    // Get all prices from infowayService cache (live WebSocket data)
    const prices = {}
    for (const symbol of symbols) {
      const price = infowayService.getPrice(symbol)
      if (price) {
        prices[symbol] = price
      }
    }
    
    res.json({ success: true, prices })
  } catch (error) {
    console.error('Error fetching batch prices:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
