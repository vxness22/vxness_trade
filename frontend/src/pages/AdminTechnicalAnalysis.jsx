import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { 
  Plus, 
  Upload, 
  Trash2, 
  Edit2, 
  Eye, 
  EyeOff,
  X,
  Image as ImageIcon,
  Save
} from 'lucide-react'
import AdminLayout from '../components/AdminLayout'
import { API_URL, API_BASE_URL } from '../config/api'

const AdminTechnicalAnalysis = () => {
  const [analyses, setAnalyses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingAnalysis, setEditingAnalysis] = useState(null)
  const [formData, setFormData] = useState({
    description: ''
  })
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchAnalyses()
  }, [])

  const fetchAnalyses = async () => {
    try {
      const res = await fetch(`${API_URL}/technical-analysis/all`)
      const data = await res.json()
      if (data.success) {
        setAnalyses(data.analyses)
      }
    } catch (error) {
      console.error('Error fetching analyses:', error)
    }
    setLoading(false)
  }

  const handleImageChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      setImageFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      const formDataToSend = new FormData()
      formDataToSend.append('title', 'Technical Analysis')
      formDataToSend.append('description', formData.description)
      
      if (imageFile) {
        formDataToSend.append('image', imageFile)
      }

      const url = editingAnalysis 
        ? `${API_URL}/technical-analysis/update/${editingAnalysis._id}`
        : `${API_URL}/technical-analysis/create`
      
      const method = editingAnalysis ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        body: formDataToSend
      })

      const data = await res.json()
      if (data.success) {
        fetchAnalyses()
        closeModal()
        toast.success('Analysis saved successfully!')
      } else {
        toast.error(data.message || 'Error saving analysis')
      }
    } catch (error) {
      console.error('Error saving analysis:', error)
      toast.error('Error saving analysis')
    }
    setSubmitting(false)
  }

  const handleToggleActive = async (id) => {
    try {
      const res = await fetch(`${API_URL}/technical-analysis/toggle/${id}`, {
        method: 'PATCH'
      })
      const data = await res.json()
      if (data.success) {
        fetchAnalyses()
      }
    } catch (error) {
      console.error('Error toggling analysis:', error)
    }
  }

  const handleDelete = async (id) => {
    toast((t) => (
      <div className="flex flex-col gap-2">
        <p>Are you sure you want to delete this analysis?</p>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              toast.dismiss(t.id)
              try {
                const res = await fetch(`${API_URL}/technical-analysis/delete/${id}`, {
                  method: 'DELETE'
                })
                const data = await res.json()
                if (data.success) {
                  toast.success('Analysis deleted')
                  fetchAnalyses()
                }
              } catch (error) {
                console.error('Error deleting analysis:', error)
                toast.error('Error deleting analysis')
              }
            }}
            className="px-3 py-1 bg-red-500 text-white rounded text-sm"
          >
            Delete
          </button>
          <button
            onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1 bg-gray-600 text-white rounded text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    ), { duration: 10000 })
  }

  const openEditModal = (analysis) => {
    setEditingAnalysis(analysis)
    setFormData({
      description: analysis.description
    })
    setImagePreview(`${API_BASE_URL}${analysis.image}`)
    setImageFile(null)
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingAnalysis(null)
    setFormData({
      description: ''
    })
    setImageFile(null)
    setImagePreview(null)
  }

  return (
    <AdminLayout title="Technical Analysis" subtitle="Upload and manage technical analysis for users">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-400 text-sm">
              Upload technical analysis images with descriptions. Users will see these via the notification bell.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-accent-green text-black rounded-lg hover:bg-accent-green/90 transition-colors font-medium"
          >
            <Plus size={18} />
            Add Analysis
          </button>
        </div>

        {/* Analyses Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-green"></div>
          </div>
        ) : analyses.length === 0 ? (
          <div className="bg-dark-700 rounded-xl p-12 text-center border border-gray-800">
            <ImageIcon size={48} className="mx-auto text-gray-600 mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">No Technical Analysis Yet</h3>
            <p className="text-gray-400 mb-4">Upload your first technical analysis to notify users.</p>
            <button
              onClick={() => setShowModal(true)}
              className="px-4 py-2 bg-accent-green text-black rounded-lg hover:bg-accent-green/90 transition-colors font-medium"
            >
              Add Analysis
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {analyses.map((analysis) => (
              <div 
                key={analysis._id} 
                className={`bg-dark-700 rounded-xl border overflow-hidden ${
                  analysis.isActive ? 'border-gray-700' : 'border-gray-800 opacity-60'
                }`}
              >
                {/* Image */}
                <div className="relative h-48 bg-dark-800">
                  <img 
                    src={`${API_BASE_URL}${analysis.image}`} 
                    alt="Technical Analysis"
                    className="w-full h-full object-cover"
                  />
                  {!analysis.isActive && (
                    <div className="absolute top-2 right-2">
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-700 text-gray-400">
                        Hidden
                      </span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-4">
                  <p className="text-gray-400 text-sm line-clamp-3 mb-3">
                    {analysis.description}
                  </p>

                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{new Date(analysis.createdAt).toLocaleDateString()}</span>
                    <span>{analysis.viewedBy?.length || 0} views</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-700">
                    <button
                      onClick={() => handleToggleActive(analysis._id)}
                      className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm transition-colors ${
                        analysis.isActive 
                          ? 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30'
                          : 'bg-green-500/20 text-green-500 hover:bg-green-500/30'
                      }`}
                    >
                      {analysis.isActive ? <EyeOff size={14} /> : <Eye size={14} />}
                      {analysis.isActive ? 'Hide' : 'Show'}
                    </button>
                    <button
                      onClick={() => openEditModal(analysis)}
                      className="flex-1 flex items-center justify-center gap-1 py-2 bg-blue-500/20 text-blue-500 rounded-lg text-sm hover:bg-blue-500/30 transition-colors"
                    >
                      <Edit2 size={14} />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(analysis._id)}
                      className="flex-1 flex items-center justify-center gap-1 py-2 bg-red-500/20 text-red-500 rounded-lg text-sm hover:bg-red-500/30 transition-colors"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-700 rounded-xl w-full max-w-lg border border-gray-700 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">
                {editingAnalysis ? 'Edit Analysis' : 'Add New Analysis'}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              {/* Image Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Analysis Image *
                </label>
                <div 
                  className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                    imagePreview ? 'border-accent-green' : 'border-gray-600 hover:border-gray-500'
                  }`}
                  onClick={() => document.getElementById('imageInput').click()}
                >
                  {imagePreview ? (
                    <div className="relative">
                      <img 
                        src={imagePreview} 
                        alt="Preview" 
                        className="max-h-48 mx-auto rounded-lg"
                      />
                      <p className="text-sm text-gray-400 mt-2">Click to change image</p>
                    </div>
                  ) : (
                    <div className="py-8">
                      <Upload size={32} className="mx-auto text-gray-500 mb-2" />
                      <p className="text-gray-400">Click to upload image</p>
                      <p className="text-xs text-gray-500 mt-1">PNG, JPG, GIF up to 5MB</p>
                    </div>
                  )}
                </div>
                <input
                  id="imageInput"
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Description *
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Enter description for this analysis..."
                  rows={4}
                  className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-accent-green resize-none"
                  required
                />
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-2.5 bg-dark-600 text-gray-300 rounded-lg hover:bg-dark-500 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || (!imageFile && !editingAnalysis) || !formData.description.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-accent-green text-black rounded-lg hover:bg-accent-green/90 transition-colors disabled:opacity-50 font-medium"
                >
                  {submitting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-black"></div>
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save size={16} />
                      {editingAnalysis ? 'Update' : 'Publish'}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}

export default AdminTechnicalAnalysis
