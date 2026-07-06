
import { Button } from "@/components/ui/button"
import { BecomePartnerDialog } from "@/components/auth-dialogs"
import { Percent, Users, Banknote, Gift, ArrowRight } from "lucide-react"

const benefits = [
  {
    icon: Percent,
    title: "Rebates up to 60%",
    description: "Volume-based commission model with scalable earnings.",
  },
  {
    icon: Users,
    title: "Client Management Tools",
    description: "Advanced multi-account infrastructure and reporting dashboard.",
  },
  {
    icon: Banknote,
    title: "Daily Commission Settlement",
    description: "Automated payout system with transparent tracking.",
  },
  {
    icon: Gift,
    title: "Exclusive Partner Incentives",
    description: "Tiered rewards and performance bonuses.",
  },
]

export function PartnershipSection() {
  return (
    <section className="py-20 lg:py-28 bg-foreground text-white relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Partnership</p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 text-balance">
            A World of Possibilities — Partner with VXNESS
          </h2>
          <p className="text-lg text-white/70 max-w-2xl mx-auto">
            Grow your network with industry-leading partnership tools.
          </p>
        </div>

        {/* Benefits Grid */}
        <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-12">
          {benefits.map((benefit, index) => (
            <div
              key={index}
              className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 sm:p-6 hover:bg-white/10 transition-colors"
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/20 rounded-xl flex items-center justify-center mb-3 sm:mb-4">
                <benefit.icon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold mb-2">{benefit.title}</h3>
              <p className="text-xs sm:text-sm text-white/60">{benefit.description}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center">
          <BecomePartnerDialog
            trigger={
              <Button size="lg" className="bg-primary hover:bg-primary/90 text-white px-8">
                Become a Partner
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            }
          />
        </div>
      </div>

      {/* Background Decorations */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
    </section>
  )
}
