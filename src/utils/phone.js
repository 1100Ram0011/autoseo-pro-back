import {
  parsePhoneNumberFromString,
} from "libphonenumber-js";

export const normalizePhoneNumber = (
  input,
  defaultCountry = "IN"
) => {

  try {

    if (!input) {

      return {
        valid: false,
      };
    }

    const raw =
      String(input).trim();

    const digits =
      raw.replace(
        /\D/g,
        ""
      );

    let parsed;

    /*
    |--------------------------------------------------------------------------
    | INTERNATIONAL FORMAT
    |--------------------------------------------------------------------------
    |
    | Examples:
    | +447448657886
    | 447448657886
    | +919876543210
    | 919876543210
    |
    */

    if (
      raw.startsWith("+")
    ) {

      parsed =
        parsePhoneNumberFromString(
          raw
        );

    } else if (
      digits.length >= 11
    ) {

      parsed =
        parsePhoneNumberFromString(
          `+${digits}`
        );
    }

    /*
    |--------------------------------------------------------------------------
    | LOCAL FORMAT
    |--------------------------------------------------------------------------
    |
    | Example:
    | 9876543210
    |
    */

    if (
      !parsed
    ) {

      parsed =
        parsePhoneNumberFromString(
          digits,
          defaultCountry
        );
    }

    if (
      !parsed ||
      !parsed.isValid()
    ) {

      return {
        valid: false,
      };
    }

    return {

      valid: true,

      country:
        parsed.country,

      national:
        parsed.nationalNumber,

      international:
        parsed.number,

      whatsapp:
        parsed.number.replace(
          "+",
          ""
        ),
    };

  } catch {

    return {
      valid: false,
    };
  }
};