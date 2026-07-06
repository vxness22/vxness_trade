import express from 'express'
import TechnicalAnalysis from '../models/TechnicalAnalysis.js'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = express.Router()

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, 'analysis-' + uniqueSuffix + path.extname(file.originalname))
  }
})

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
    const mimetype = allowedTypes.test(file.mimetype)
    if (extname && mimetype) {
      return cb(null, true)
    }
    cb(new Error('Only image files are allowed'))
  }
})

// Get all technical analyses (admin)
router.get('/all', async (req, res) => {
  try {
    const analyses = await TechnicalAnalysis.find()
      .sort({ createdAt: -1 })
    res.json({ success: true, analyses })
  } catch (error) {
    console.error('Error fetching analyses:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// Get active technical analyses (for users)
router.get('/active', async (req, res) => {
  try {
    const analyses = await TechnicalAnalysis.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(10)
    res.json({ success: true, analyses })
  } catch (error) {
    console.error('Error fetching active analyses:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// Get unread count for a user
router.get('/unread-count/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const analyses = await TechnicalAnalysis.find({ isActive: true })
    
    let unreadCount = 0
    analyses.forEach(analysis => {
      const hasViewed = analysis.viewedBy.some(v => v.userId.toString() === userId)
      if (!hasViewed) unreadCount++
    })
    
    res.json({ success: true, unreadCount })
  } catch (error) {
    console.error('Error fetching unread count:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// Mark analysis as viewed by user
router.post('/mark-viewed/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { userId } = req.body
    
    const analysis = await TechnicalAnalysis.findById(id)
    if (!analysis) {
      return res.status(404).json({ success: false, message: 'Analysis not found' })
    }
    
    // Check if already viewed
    const alreadyViewed = analysis.viewedBy.some(v => v.userId.toString() === userId)
    if (!alreadyViewed) {
      analysis.viewedBy.push({ userId, viewedAt: new Date() })
      await analysis.save()
    }
    
    res.json({ success: true })
  } catch (error) {
    console.error('Error marking as viewed:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// Create new technical analysis (admin)
router.post('/create', upload.single('image'), async (req, res) => {
  try {
    const { title, description, symbol, analysisType } = req.body
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Image is required' })
    }
    
    const analysis = new TechnicalAnalysis({
      title,
      description,
      image: `/uploads/${req.file.filename}`,
      symbol: symbol || '',
      analysisType: analysisType || 'neutral',
      isActive: true
    })
    
    await analysis.save()
    res.json({ success: true, analysis })
  } catch (error) {
    console.error('Error creating analysis:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// Update technical analysis (admin)
router.put('/update/:id', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params
    const { title, description, symbol, analysisType, isActive } = req.body
    
    const analysis = await TechnicalAnalysis.findById(id)
    if (!analysis) {
      return res.status(404).json({ success: false, message: 'Analysis not found' })
    }
    
    analysis.title = title || analysis.title
    analysis.description = description || analysis.description
    analysis.symbol = symbol !== undefined ? symbol : analysis.symbol
    analysis.analysisType = analysisType || analysis.analysisType
    analysis.isActive = isActive !== undefined ? isActive === 'true' || isActive === true : analysis.isActive
    
    if (req.file) {
      analysis.image = `/uploads/${req.file.filename}`
    }
    
    await analysis.save()
    res.json({ success: true, analysis })
  } catch (error) {
    console.error('Error updating analysis:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// Toggle active status (admin)
router.patch('/toggle/:id', async (req, res) => {
  try {
    const { id } = req.params
    const analysis = await TechnicalAnalysis.findById(id)
    
    if (!analysis) {
      return res.status(404).json({ success: false, message: 'Analysis not found' })
    }
    
    analysis.isActive = !analysis.isActive
    await analysis.save()
    
    res.json({ success: true, analysis })
  } catch (error) {
    console.error('Error toggling analysis:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// Delete technical analysis (admin)
router.delete('/delete/:id', async (req, res) => {
  try {
    const { id } = req.params
    await TechnicalAnalysis.findByIdAndDelete(id)
    res.json({ success: true, message: 'Analysis deleted' })
  } catch (error) {
    console.error('Error deleting analysis:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

export default router
