import axios from 'axios';

/**
 * Looks up a person on RocketReach to enrich their profile with contact info.
 * @param {Object} params
 * @param {string} params.employeeName - The name of the employee.
 * @param {string} params.profileUrl - The LinkedIn profile URL of the employee.
 * @param {string} params.companyName - The name of the company.
 * @returns {Promise<Object|null>} An object with contact info or null if none found.
 */
export const lookupRocketReachPerson = async ({ employeeName, profileUrl, companyName }) => {
    if (!process.env.ROCKETREACH_API_KEY) {
        throw new Error('RocketReach API key not found in server env');
    }

    let url = `https://api.rocketreach.co/api/v2/person/lookup?`;
    if (profileUrl) {
        url += `linkedin_url=${encodeURIComponent(profileUrl)}`;
    } else {
        url += `name=${encodeURIComponent(employeeName)}&current_employer=${encodeURIComponent(companyName)}`;
    }

    try {
        const { data } = await axios.get(url, {
            headers: {
                'Api-Key': process.env.ROCKETREACH_API_KEY
            }
        });

        if (data) {
            let emails = data.emails || [];
            let phones = data.phones || [];
            let professionalEmail = '';
            let personalEmail = '';

            for (let e of emails) {
                let emailStr = typeof e === 'object' ? (e.email || e.smtp_email || '') : e;
                if (!emailStr) continue;
                const isPersonal = /@gmail\.com|@yahoo\.com|@hotmail\.com|@outlook\.com|@icloud\.com|@live\.com/i.test(emailStr);
                if (isPersonal && !personalEmail) {
                    personalEmail = emailStr;
                } else if (!isPersonal && !professionalEmail) {
                    professionalEmail = emailStr;
                }
            }

            let extractedPhones = [];
            for (let p of phones) {
                let num = typeof p === 'object' ? (p.number || p.phone || '') : p;
                if (num && typeof num === 'string' && !extractedPhones.includes(num)) {
                    extractedPhones.push(num);
                }
            }

            let rrPhone = extractedPhones[0] || '';
            let rrPhone2 = extractedPhones.length > 1 ? extractedPhones.slice(1).join(', ') : '';

            // If we didn't find any contact info, return null
            if (!professionalEmail && !personalEmail && !rrPhone && !rrPhone2) {
                return null;
            }

            return {
                email: professionalEmail,
                personalEmail: personalEmail,
                phone: rrPhone,
                mobilePhone: rrPhone2
            };
        }

        return null;
    } catch (error) {
        console.error('RocketReach lookup failed:', error.message);
        return null; // Don't throw, just return null so we can keep processing other employees
    }
};
