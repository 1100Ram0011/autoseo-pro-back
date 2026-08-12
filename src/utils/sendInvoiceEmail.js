import moment from "moment";
import { sendOutlookMail } from "../config/mailer.js";
import config from "../config/config.js";
import Employee from "../models/bgv/empFormSchema.js";
import logger from "../config/logger.js";

export const sendInvoiceEmail = async (
  to,
  invoice,
  transaction,
  employees,
  pdfBuffer,
) => {
  //  FIX : employees undefined OR IDs only
  if (!Array.isArray(employees) || employees.length === 0) {
    employees = [];
  }

  //  Employees IDs ko full data me convert

  let employeeData = [];

  try {
    employeeData = await Employee.find({
      _id: { $in: employees },
    }).populate("services"); // <-- if services is a reference
  } catch (err) { }
  console.log("email - ", to)
  // Employees may be IDs → convert safely
  const servicesHtml = employeeData
    .map((emp) => {
      if (!emp || typeof emp !== "object") {
        return `<h4>Unknown Employee</h4>`;
      }

      const empName = emp.empName || "N/A";
      const aadhaar = emp.empAadharNumber || "N/A";

      // Services safe-handling
      const servicesList = Array.isArray(emp.services)
        ? emp.services
          .map(
            (s) =>
              `<li>${s.serviceName || "Service"} - ₹${s.price || 0}</li>`,
          )
          .join("")
        : "<li>No services found</li>";

      return `
        <h3>${empName}</h3>
        <ul>${servicesList}</ul>
      `;
    })
    .join("");

  // Send Email
  try {
    await sendOutlookMail({
      to: to,
      subject: `Invoice ${invoice?.invoiceNumber || ""}`,
      htmlBody: `
        <h2>Invoice ${invoice?.invoiceNumber || ""}</h2>
        <p><b>Total Amount:</b> ₹${invoice?.amount || 0}</p>

        <h3>Employee Billing Details</h3>
        ${servicesHtml}

        <p><b>Issued At:</b> ${invoice?.createdAt || moment().format()}</p>
        <p>Thank you for using Open 4 All!</p>
    `,
      attachments: [
        {
          filename: `Invoice_${invoice?.invoiceNumber || "file"}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });
  } catch (err) {
    console.log("error", err)
    logger.error("Failed to send invoice:", err.message);
  }
};
