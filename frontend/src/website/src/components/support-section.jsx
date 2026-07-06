import { Headphones, HelpCircle, BookOpen, Globe } from "lucide-react"

const supportFeatures = [
  {
    icon: Headphones,
    title: "24/7 Client Assistance",
  },
  {
    icon: HelpCircle,
    title: "Help Center Access",
  },
  {
    icon: BookOpen,
    title: "Knowledge Base & FAQs",
  },
  {
    icon: Globe,
    title: "Multilingual Support",
  },
]

export function SupportSection() {
  return (
    <section className="py-20 lg:py-28 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Support</p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Dedicated Support Infrastructure
          </h2>
        </div>

        {/* Support Features */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          {supportFeatures.map((feature, index) => (
            <div
              key={index}
              className="bg-muted/50 rounded-2xl p-4 sm:p-6 text-center hover:bg-muted transition-colors"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
                <feature.icon className="w-6 h-6 sm:w-7 sm:h-7 text-primary" />
              </div>
              <h3 className="text-sm sm:text-lg font-semibold text-foreground">{feature.title}</h3>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
