// Defines the popup forms admin can push to a user's page.
// Shared shape is duplicated in public/admin/admin.js and public/user/user.js
// (kept as plain JSON here so it can also be served via /api/form-templates).
// Auto-opened for every visitor as soon as they land on a page (see socket.js
// user:register). Admin can still push any other template on top of it.
const DEFAULT_FORM_TYPE = 'enquiry_form';

const FORM_TEMPLATES = {
  enquiry_form: {
    label: "Enquiry Form",
    fields: [
      { name: "name", label: "Full Name", type: "text", required: true },
      { name: "courses", label: "Course", type: "text", required: true },
      { name: "education", label: "Education", type: "text", required: false },
    ],
  },
  lead_form: {
    label: "Lead Form",
    fields: [
      { name: "name", label: "Full Name", type: "text", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "phone", label: "Phone", type: "tel", required: false },
      { name: "message", label: "Message", type: "textarea", required: false },
    ],
  },
  contact_form: {
    label: "Contact Form",
    fields: [
      { name: "name", label: "Full Name", type: "text", required: true },
      { name: "company", label: "Company", type: "text", required: false },
      { name: "email", label: "Email", type: "email", required: true },
    ],
  },
  quote_form: {
    label: "Get a Quote",
    fields: [
      { name: "name", label: "Full Name", type: "text", required: true },
      { name: "budget", label: "Budget", type: "text", required: false },
      {
        name: "details",
        label: "Project Details",
        type: "textarea",
        required: false,
      },
    ],
  },
  otp_form: {
    label: "OTP Form",
    fields: [
      { name: "OTP", label: "Enter OTP", type: "number", required: true },
    ],
  },
};

module.exports = { FORM_TEMPLATES, DEFAULT_FORM_TYPE };
