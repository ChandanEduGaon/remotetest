// Defines the popup forms admin can push to a user's page.
// Shared shape is duplicated in public/admin/admin.js and public/user/user.js
// (kept as plain JSON here so it can also be served via /api/form-templates).
const FORM_TEMPLATES = {
  lead_form: {
    label: 'Lead Form',
    fields: [
      { name: 'name', label: 'Full Name', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'phone', label: 'Phone', type: 'tel', required: false },
      { name: 'message', label: 'Message', type: 'textarea', required: false }
    ]
  },
  contact_form: {
    label: 'Contact Form',
    fields: [
      { name: 'name', label: 'Full Name', type: 'text', required: true },
      { name: 'company', label: 'Company', type: 'text', required: false },
      { name: 'email', label: 'Email', type: 'email', required: true }
    ]
  },
  quote_form: {
    label: 'Get a Quote',
    fields: [
      { name: 'name', label: 'Full Name', type: 'text', required: true },
      { name: 'budget', label: 'Budget', type: 'text', required: false },
      { name: 'details', label: 'Project Details', type: 'textarea', required: false }
    ]
  }
};

module.exports = { FORM_TEMPLATES };
