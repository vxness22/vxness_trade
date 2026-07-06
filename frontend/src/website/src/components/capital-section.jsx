import { Shield, Clock, Globe, Building2 } from "lucide-react"

const features = [
  {
    icon: Shield,
    title: "Segregated banking infrastructure",
  },
  {
    icon: Clock,
    title: "Same-day withdrawal processing",
  },
  {
    icon: Globe,
    title: "Multi-currency account support",
  },
  {
    icon: Building2,
    title: "Institutional payment gateways",
  },
]

export function CapitalSection() {
  return (
    <section className="py-20 lg:py-28 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left - Visual */}
          <div className="relative order-2 lg:order-1">
            <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-3xl p-4 sm:p-8 lg:p-12">
              <div className="grid grid-cols-1 xs:grid-cols-2 gap-3 sm:gap-4">
                {features.map((feature, index) => (
                  <div key={index} className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-3 sm:mb-4">
                      <feature.icon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                    </div>
                    <p className="text-xs sm:text-sm font-medium text-foreground">{feature.title}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Content */}
          <div className="order-1 lg:order-2">
            <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Capital Management</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-6 text-balance">
              Streamlined Capital Management Operations
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Zero deposit fees. Withdrawal conditions may vary by payment method.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
