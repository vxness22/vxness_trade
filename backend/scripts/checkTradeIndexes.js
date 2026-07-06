// Script to check and remove TTL indexes on Trade collection
import mongoose from 'mongoose'
import dotenv from 'dotenv'

dotenv.config()

async function checkAndFixIndexes() {
  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log('Connected to MongoDB')

    const db = mongoose.connection.db
    const tradeCollection = db.collection('trades')

    // Get all indexes
    const indexes = await tradeCollection.indexes()
    console.log('\nCurrent indexes on trades collection:')
    console.log(JSON.stringify(indexes, null, 2))

    // Check for TTL indexes (expireAfterSeconds)
    const ttlIndexes = indexes.filter(idx => idx.expireAfterSeconds !== undefined)
    
    if (ttlIndexes.length > 0) {
      console.log('\n⚠️  Found TTL indexes that auto-delete documents:')
      for (const idx of ttlIndexes) {
        console.log(`  - Index: ${idx.name}, Field: ${Object.keys(idx.key).join(', ')}, Expires after: ${idx.expireAfterSeconds} seconds (${(idx.expireAfterSeconds / 86400).toFixed(1)} days)`)
        
        // Drop the TTL index
        console.log(`  Dropping index: ${idx.name}...`)
        await tradeCollection.dropIndex(idx.name)
        console.log(`  ✅ Index ${idx.name} dropped successfully!`)
      }
    } else {
      console.log('\n✅ No TTL indexes found on trades collection')
    }

    // Also check transactions collection
    const transactionCollection = db.collection('transactions')
    const txIndexes = await transactionCollection.indexes()
    const txTtlIndexes = txIndexes.filter(idx => idx.expireAfterSeconds !== undefined)
    
    if (txTtlIndexes.length > 0) {
      console.log('\n⚠️  Found TTL indexes on transactions collection:')
      for (const idx of txTtlIndexes) {
        console.log(`  - Index: ${idx.name}, Expires after: ${(idx.expireAfterSeconds / 86400).toFixed(1)} days`)
      }
    }

    console.log('\nDone!')
    process.exit(0)
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

checkAndFixIndexes()
