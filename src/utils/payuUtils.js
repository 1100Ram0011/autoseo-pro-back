import crypto from "crypto";
import config from "../config/config.js";

const PAYU_KEY = config.PAYU_KEY;
const PAYU_SALT = config.PAYU_SALT;

export const generatePayuHash = ({
  txnid,
  amount,
  productinfo,
  firstname,
  email,
  udf1 = "",
  udf2 = "",
  udf3 = "",
  udf4 = "",
  udf5 = "",
  si_details = "",
}) => {
  const hashString = `${PAYU_KEY}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${si_details}|${PAYU_SALT}`;
  return crypto.createHash("sha512").update(hashString).digest("hex");
};

export const verifyPayuHash = ({
  status,
  txnid,
  amount,
  productinfo,
  firstname,
  email,
  udf1 = "",
  udf2 = "",
  udf3 = "",
  udf4 = "",
  udf5 = "",
  si_details = "",
  hash,
}) => {
  const hashString = `${PAYU_SALT}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${PAYU_KEY}`;
  const calculatedHash = crypto
    .createHash("sha512")
    .update(hashString)
    .digest("hex");
  return calculatedHash === hash;
};

export const generatePayuHashNormal = ({
  txnid,
  amount,
  productinfo,
  firstname,
  email,
  udf1 = "",
  udf2 = "",
  udf3 = "",
  udf4 = "",
  udf5 = "",
}) => {
  const hashString =
    `${config.PAYU_KEY}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|` +
    `${udf1}|${udf2}|${udf3}|${udf4}|${udf5}` +
    `||||||${config.PAYU_SALT}`;

  console.log("HASH STRING:", hashString);

  return crypto.createHash("sha512").update(hashString).digest("hex");
};
