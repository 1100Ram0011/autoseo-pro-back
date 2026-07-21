"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const email = 'mytekinnovations@gmail.com';
    const user = await prisma.user.findUnique({
        where: { email },
        include: { sites: true }
    });
    if (user) {
        console.log("=== USER VERIFICATION ===");
        console.log(`Email: ${user.email}`);
        console.log(`User ID: ${user.id}`);
        console.log(`\n=== SITES ASSOCIATED WITH USER ===`);
        if (user.sites.length > 0) {
            user.sites.forEach(site => {
                console.log(`Site ID: ${site.id}`);
                console.log(`URL: ${site.url}`);
                console.log(`Created At: ${site.createdAt}`);
            });
        }
        else {
            console.log("No sites found for this user.");
        }
    }
    else {
        console.log(`User with email ${email} not found.`);
    }
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=verify.js.map