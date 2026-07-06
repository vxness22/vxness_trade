// Seeds the fundedfriday-style challenge plans (Instant Fund / One Step / Two Step).
// Idempotent: upserts keyed on `name`, so re-running won't create duplicates.
//
//   Run:  npm run seed:challenges      (from backend/)
//
// NOTE: Only the smallest size of each family has a fee taken from fundedfriday's
// public page ($159 / $70 / $60). Larger-size fees below are PLACEHOLDERS — edit
// them here or in the admin panel (Prop Trading -> Challenges) to match your pricing.

import 'dotenv/config'
import mongoose from 'mongoose'
import Challenge from '../models/Challenge.js'

const sizeLabel = (n) => `${n / 1000}K`

// fee tables per family (size -> fee). First entry per family is the real fundedfriday fee.
const INSTANT = {
  split: 80, leverage: 50, dailyDD: 3, overallDD: 5, drawdownType: 'TRAILING',
  fees: { 10000: 159, 25000: 299, 50000: 499 },
}
const ONE_STEP = {
  split: 80, leverage: 100, dailyDD: 3, overallDD: 6, drawdownType: 'STATIC', target1: 10,
  fees: { 5000: 70, 15000: 130, 25000: 220, 50000: 333, 100000: 539, 200000: 990 },
}
const TWO_STEP = {
  split: 90, leverage: 100, dailyDD: 5, overallDD: 8, drawdownType: 'STATIC', target1: 10, target2: 8,
  fees: { 5000: 60, 15000: 110, 25000: 199, 50000: 299, 100000: 499, 200000: 900 },
}

function buildPlans() {
  const plans = []

  // Instant Fund — stepsCount 0, funded immediately, no profit target
  for (const [size, fee] of Object.entries(INSTANT.fees)) {
    const fundSize = Number(size)
    plans.push({
      name: `${sizeLabel(fundSize)} Instant Fund`,
      description: 'Instant funding — no evaluation. Just follow the rules.',
      stepsCount: 0,
      fundSize,
      challengeFee: fee,
      rules: {
        maxDailyDrawdownPercent: INSTANT.dailyDD,
        maxOverallDrawdownPercent: INSTANT.overallDD,
        drawdownType: INSTANT.drawdownType,
        maxLeverage: INSTANT.leverage,
        stopLossMandatory: false,
        challengeExpiryDays: 365,
      },
      fundedSettings: { profitSplitPercent: INSTANT.split, withdrawalFrequencyDays: 14 },
      isActive: true,
      sortOrder: fundSize,
    })
  }

  // One Step — stepsCount 1, single evaluation
  for (const [size, fee] of Object.entries(ONE_STEP.fees)) {
    const fundSize = Number(size)
    plans.push({
      name: `${sizeLabel(fundSize)} One Step`,
      description: 'Single evaluation phase, then funded.',
      stepsCount: 1,
      fundSize,
      challengeFee: fee,
      rules: {
        maxDailyDrawdownPercent: ONE_STEP.dailyDD,
        maxOverallDrawdownPercent: ONE_STEP.overallDD,
        drawdownType: ONE_STEP.drawdownType,
        profitTargetPhase1Percent: ONE_STEP.target1,
        maxLeverage: ONE_STEP.leverage,
        stopLossMandatory: false,
        challengeExpiryDays: 30,
      },
      fundedSettings: { profitSplitPercent: ONE_STEP.split, withdrawalFrequencyDays: 14 },
      isActive: true,
      sortOrder: fundSize,
    })
  }

  // Two Step — stepsCount 2, dual evaluation
  for (const [size, fee] of Object.entries(TWO_STEP.fees)) {
    const fundSize = Number(size)
    plans.push({
      name: `${sizeLabel(fundSize)} Two Step`,
      description: 'Two evaluation phases, then funded.',
      stepsCount: 2,
      fundSize,
      challengeFee: fee,
      rules: {
        maxDailyDrawdownPercent: TWO_STEP.dailyDD,
        maxOverallDrawdownPercent: TWO_STEP.overallDD,
        drawdownType: TWO_STEP.drawdownType,
        profitTargetPhase1Percent: TWO_STEP.target1,
        profitTargetPhase2Percent: TWO_STEP.target2,
        maxLeverage: TWO_STEP.leverage,
        stopLossMandatory: false,
        challengeExpiryDays: 30,
      },
      fundedSettings: { profitSplitPercent: TWO_STEP.split, withdrawalFrequencyDays: 14 },
      isActive: true,
      sortOrder: fundSize,
    })
  }

  return plans
}

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set in backend/.env')
    process.exit(1)
  }
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB')

  const plans = buildPlans()
  let created = 0, updated = 0
  for (const plan of plans) {
    // $set rules/fundedSettings as whole sub-objects (merge defaults at schema level)
    const r = await Challenge.updateOne({ name: plan.name }, { $set: plan }, { upsert: true })
    if (r.upsertedCount) created++
    else updated++
  }

  console.log(`Seeded challenges: ${created} created, ${updated} updated (total ${plans.length})`)
  console.log('Reminder: larger-size fees are placeholders — edit in admin if needed.')
  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => { console.error(err); process.exit(1) })
