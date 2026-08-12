export const serviceFieldMapping = {
  "Identity Check": [
    "alternativeNumber",
    "emergencyContactNumber",
    "neighbourName",
    "neighbourContactNumber",
    "passport",
    "voterId",
    "drivingLicence",
  ],

  "Address Verification": [
    "currentAddress[0].address",
    "currentAddress[0].area",
    "currentAddress[0].city",
    "currentAddress[0].landmark",
    "currentAddress[0].taluka",
    "currentAddress[0].district",
    "currentAddress[0].state",
    "currentAddress[0].country",
    "currentAddress[0].pincode",

    // documents inside current address
    "currentAddress[0].documents.rentAgreement",
    "currentAddress[0].documents.electricityBill",
    "currentAddress[0].documents.currentAddressGeoTaggingSelfi",
    "currentAddress[0].documents.geolocationHistory",

    // permanent address fields
    "permanentAddress[0].address",
    "permanentAddress[0].area",
    "permanentAddress[0].city",
    "permanentAddress[0].landmark",
    "permanentAddress[0].taluka",
    "permanentAddress[0].district",
    "permanentAddress[0].state",
    "permanentAddress[0].country",
    "permanentAddress[0].pincode",

    "lightBill",
    "stateCode",
    "neighbourName",
    "neighbourContactNumber",
  ],

  "Employment Verification": [
    "uan",

    // employment history (first item)
    "employmentHistory[0].previousCompanyName",
    "employmentHistory[0].address",
    "employmentHistory[0].role",
    "employmentHistory[0].reasonOfLeaving",
    "employmentHistory[0].employmentName",
    "employmentHistory[0].employeeType",
    "employmentHistory[0].duration",
    "employmentHistory[0].empId",
    "employmentHistory[0].ctc",

    // nested documents inside employmentHistory
    "employmentHistory[0].documents.bankStatement",
    "employmentHistory[0].documents.salarySlip",
    "employmentHistory[0].documents.experienceLetter",
    "employmentHistory[0].documents.relievingLetter",

    // references is an array of ObjectIds
    "employmentHistory[0].references",
  ],

  "Credit Check": ["gender", "aadhaar", "pan", "consent"],
};
