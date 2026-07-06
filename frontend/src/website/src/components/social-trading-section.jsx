import { Button } from "@/components/ui/button"
import { ArrowRight, TrendingUp, Users, Award } from "lucide-react"

export function SocialTradingSection() {
  return (
    <section className="py-20 lg:py-28 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left Content */}
          <div>
            <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Social Trading</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-6 text-balance">
              Social Trading Ecosystem
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Connect, copy, and grow with experienced market participants. Diversify strategies and optimize portfolio performance through transparent leaderboards and performance metrics.
            </p>

            <Button size="lg" className="bg-primary hover:bg-primary/90 text-white px-8">
              Explore Copy Trading
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>

          {/* Right - Visual */}
          <div className="relative">
            <div className="bg-gradient-to-br from-primary/5 to-muted rounded-3xl p-6 lg:p-8">
              {/* Trader Cards */}
              <div className="space-y-4">
                {[
                  { name: "Alex Chen", profit: "+42.5%", followers: "12.4k", rank: 1 },
                  { name: "Sarah Miller", profit: "+38.2%", followers: "9.8k", rank: 2 },
                  { name: "John Davis", profit: "+35.7%", followers: "7.2k", rank: 3 },
                ].map((trader, index) => (
                  <div key={index} className="bg-white rounded-xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                      <span className="text-primary font-bold">{trader.rank}</span>
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-foreground">{trader.name}</div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="w-4 h-4" />
                          {trader.followers}
                        </span>
                        <span className="flex items-center gap-1 text-primary">
                          <TrendingUp className="w-4 h-4" />
                          {trader.profit}
                        </span>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="text-primary border-primary hover:bg-primary hover:text-white">
                      Copy
                    </Button>
                  </div>
                ))}
              </div>

              {/* Stats Banner */}
              <div className="mt-6 bg-primary text-white rounded-xl p-4 grid grid-cols-3 gap-2 sm:flex sm:items-center sm:justify-center sm:gap-8">
                <div className="text-center">
                  <div className="text-lg sm:text-2xl font-bold">50K+</div>
                  <div className="text-xs sm:text-sm text-white/70">Active Traders</div>
                </div>
                <div className="hidden sm:block w-px h-10 bg-white/20" />
                <div className="text-center">
                  <div className="text-lg sm:text-2xl font-bold">$2.5B+</div>
                  <div className="text-xs sm:text-sm text-white/70">Copied Volume</div>
                </div>
                <div className="hidden sm:block w-px h-10 bg-white/20" />
                <div className="text-center">
                  <div className="text-lg sm:text-2xl font-bold">180+</div>
                  <div className="text-xs sm:text-sm text-white/70">Countries</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
