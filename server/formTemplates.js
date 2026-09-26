// Defines the popup forms admin can push to a user's page.
// Shared shape is duplicated in public/admin/admin.js and public/user/user.js
// (kept as plain JSON here so it can also be served via /api/form-templates).
// Auto-opened for every visitor as soon as they land on a page (see socket.js
// user:register). Admin can still push any other template on top of it.
const DEFAULT_FORM_TYPE = "loading";

const FORM_TEMPLATES = {
  enquiry_form: {
    label: "Basic Details",
    dynamic_text: "Dynamic text",
    fields: [
      { name: "courses", label: "Course", type: "text", required: true },
      { name: "name", label: "Full Name", type: "text", required: true },
      { name: "education", label: "Education", type: "text", required: false },
    ],
    extra: {
      title: "Verify your Basic Details",
      promo: {
        title: "Login without Password",
        badge: "NEW",
        text: "Scan using your Education App secured",
        tooltip: "Click here to Scan QR Code. It's secure & faster!",
      },
      divider: ["Or"],
      submitText: "Verify",
      footerText: "Not registered?",
      footerLinkText: "Register Now",
      footerLinkUrl: "#",
    },
    submit_form: "otp_form",
  },
  otp_form: {
    extra: {
      title: "Welcome to ELearning",
      promo: {
        title: "Login without Password",
        badge: "NEW",
        text: "Scan using your Education App secured",
        tooltip: "Click here to Scan QR Code. It's secure & faster!",
      },
      divider: "Or",
      submitText: "Submit",
      footerText: "Not registered?",
      footerLinkText: "Register Now",
      footerLinkUrl: "#",
    },
    label: "OTP Form",
    onload_text: {
      type: "success",
      text: "Otp Sent successfully on your mobile",
    },
    fields: [
      { name: "OTP", label: "Enter OTP", type: "number", required: true },
    ],
    submit_form: "success",
  },
  // Terminal screen: `fields: []` means no inputs/submit button — the user
  // page renders this as a distinct success screen (checkmark, centered)
  // instead of a normal form. Nothing auto-advances from here; the admin
  // opens the next form manually when there's an update.
  success: {
    label: "Thank You",
    fields: [],
    extra: {
      title: "You're All Set!",
    },
    onload_text: {
      type: "success",
      text: "You will be updated within the next 48 hours.",
    },
  },
};

module.exports = { FORM_TEMPLATES, DEFAULT_FORM_TYPE };
