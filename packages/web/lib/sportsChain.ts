export const sportsChain = {
  id: 54321,
  name: 'SportsChain',
  nativeCurrency: { name: 'Sports Ether', symbol: 'SPT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.sportschain.io'] },
    public: { http: ['https://rpc.testnet.sportschain.io'] },
  },
  blockExplorers: {
    default: {
      name: 'SportsChain Explorer',
      url: 'https://scan.testnet.sportschain.io',
    },
  },
  testnet: true,
} as const
