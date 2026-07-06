// Script to create a new admin account

import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import Admin from '../models/Admin.js'
import AdminWallet from '../models/AdminWallet.js'

dotenv.config()

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log('Connected to MongoDB')

    
    const adminData = {
      email: 'admin@vxness.com',
      password: 'Admin@123',
      firstName: 'Super',
      lastName: 'Admin',
      phone: '',
      urlSlug: 'main',
      brandName: 'VXness Trading',
      role: 'SUPER_ADMIN'
    }

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email: adminData.email.toLowerCase() })
    if (existingAdmin) {
      console.log('Admin with this email already exists!')
      console.log('Email:', existingAdmin.email)
      console.log('Role:', existingAdmin.role)
      console.log('Status:', existingAdmin.status)
      await mongoose.disconnect()
      process.exit(0)
    }

    // Check if URL slug exists
    const existingSlug = await Admin.findOne({ urlSlug: adminData.urlSlug.toLowerCase() })
    if (existingSlug) {
      console.log('URL slug already exists! Choose a different one.')
      await mongoose.disconnect()
      process.exit(1)
    }

    const hashedPassword = await bcrypt.hash(adminData.password, 10)

    // Create admin
    const admin = new Admin({
      email: adminData.email.toLowerCase(),
      password: hashedPassword,
      firstName: adminData.firstName,
      lastName: adminData.lastName,
      phone: adminData.phone,
      urlSlug: adminData.urlSlug.toLowerCase(),
      brandName: adminData.brandName,
      role: adminData.role,
      status: 'ACTIVE',
      permissions: {
        canManageUsers: true,
        canCreateUsers: true,
        canDeleteUsers: true,
        canViewUsers: true,
        canManageTrades: true,
        canCloseTrades: true,
        canModifyTrades: true,
        canManageAccounts: true,
        canCreateAccounts: true,
        canDeleteAccounts: true,
        canModifyLeverage: true,
        canManageDeposits: true,
        canApproveDeposits: true,
        canManageWithdrawals: true,
        canApproveWithdrawals: true,
        canManageKYC: true,
        canApproveKYC: true,
        canManageIB: true,
        canApproveIB: true,
        canManageCopyTrading: true,
        canApproveMasters: true,
        canManageSymbols: true,
        canManageGroups: true,
        canManageSettings: true,
        canManageTheme: true,
        canViewReports: true,
        canExportReports: true,
        canManageAdmins: true,
        canFundAdmins: true
      }
    })

    await admin.save()
    console.log('Admin created successfully!')

    // Create wallet for admin
    const wallet = new AdminWallet({
      adminId: admin._id,
      balance: 0
    })
    await wallet.save()
    console.log('Admin wallet created!')

    console.log('\n========== ADMIN CREDENTIALS ==========')
    console.log('Email:', adminData.email)
    console.log('Password:', adminData.password)
    console.log('Role:', adminData.role)
    console.log('URL Slug:', adminData.urlSlug)
    console.log('========================================')
    console.log('\nPlease change the password after first login!')

    await mongoose.disconnect()
    console.log('\nDisconnected from MongoDB')
    process.exit(0)
  } catch (error) {
    console.error('Error creating admin:', error.message)
    await mongoose.disconnect()
    process.exit(1)
  }
}

createAdmin()
