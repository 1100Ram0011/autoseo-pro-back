import UserAsset from "../../../models/UserAsset.js";

export const buildPrompt = async ({
    template,
    generation,
}) => {

    let finalPrompt =
        template.prompt;

    const images = [];

    for (const input of generation.inputAssets) {

        if (input.fieldType === "image") {

            images.push(input.value);

            finalPrompt =
                finalPrompt.replaceAll(

                    `{{${input.fieldName}}}`,

                    `Reference Image ${images.length} (${input.fieldName})`

                );

        }

        else {

            finalPrompt =
                finalPrompt.replaceAll(

                    `{{${input.fieldName}}}`,

                    input.value

                );

        }

    }
    return {

        prompt:
            finalPrompt,

        images,

    };

};