import ffmpeg from 'fluent-ffmpeg'
import ffprobeStatic from 'ffprobe-static'

ffmpeg.setFfprobePath(
  ffprobeStatic.path
)

export const getVideoMetadata = (
  videoPath
) => {
  return new Promise(
    (resolve, reject) => {
      ffmpeg.ffprobe(
        videoPath,
        (error, metadata) => {
          if (error) {
            return reject(error)
          }

          const videoStream =
            metadata.streams.find(
              (stream) =>
                stream.codec_type ===
                'video'
            )

          if (!videoStream) {
            return reject(
              new Error(
                'No video stream found'
              )
            )
          }

          resolve({
            width:
              videoStream.width || 0,

            height:
              videoStream.height || 0,

            codec:
              videoStream.codec_name,

            bitrate: Number(
              metadata.format.bit_rate || 0
            ),

            duration: Number(
              metadata.format.duration || 0
            ),

            fps:
              videoStream.r_frame_rate,
          })
        }
      )
    }
  )
}