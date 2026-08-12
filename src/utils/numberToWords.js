export const numberToWords = (amount) => {
  const ones = [
    "",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
  ];
  const teens = [
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const tens = [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ];
  const thousands = ["", "thousand", "lakh", "crore"];

  const convertGroup = (n) => {
    let result = "";
    if (n >= 100) {
      result += ones[Math.floor(n / 100)] + " hundred ";
      n %= 100;
    }
    if (n >= 20) {
      result += tens[Math.floor(n / 10)] + " ";
      n %= 10;
    } else if (n >= 10) {
      result += teens[n - 10] + " ";
      return result;
    }
    if (n > 0) {
      result += ones[n] + " ";
    }
    return result;
  };

  const convertNumber = (num) => {
    if (num === 0) return "zero";
    let result = "";
    let groupIndex = 0;

    while (num > 0) {
      let group;
      if (groupIndex === 0) {
        group = num % 1000;
        num = Math.floor(num / 1000);
      } else {
        group = num % 100;
        num = Math.floor(num / 100);
      }
      if (group > 0) {
        result = convertGroup(group) + thousands[groupIndex] + " " + result;
      }
      groupIndex++;
    }

    return result.trim();
  };

  // Split rupees and paise
  const [rupeesPart, paisePart] = amount.toFixed(2).split(".");
  let words = "";

  const rupees = parseInt(rupeesPart);
  const paise = parseInt(paisePart);

  if (rupees > 0) {
    words += convertNumber(rupees) + " rupees";
  }
  if (paise > 0) {
    words += " and " + convertNumber(paise) + " paise";
  }

  let finalResult = (words.length > 0 ? words.trim() + " only" : "").replace(/\s+/g, " ");

  // Convert to Title Case
  finalResult = finalResult
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  return finalResult;
};
