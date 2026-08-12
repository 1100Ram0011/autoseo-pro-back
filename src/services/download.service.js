import axios from 'axios'
import fs from 'fs'
import path from 'path'
import fsExtra from 'fs-extra'

export const downloadVideoFile = async ({
  videoUrl,
  outputDir,
  fileName = 'input.mp4',
}) => {
  await fsExtra.ensureDir(outputDir)

  const outputPath = path.join(
    outputDir,
    fileName
  )

  const response = await axios({
    url: videoUrl,
    method: 'GET',
    responseType: 'stream',
    timeout: 1000 * 60 * 10,
  })

  await new Promise((resolve, reject) => {
    const writer =
      fs.createWriteStream(outputPath)

    response.data.pipe(writer)

    writer.on('finish', resolve)

    writer.on('error', reject)
  })

  return outputPath
}