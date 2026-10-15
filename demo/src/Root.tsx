import { Composition, staticFile, type CalculateMetadataFunction } from 'remotion'
import { Demo, type DemoProps } from './Demo'
import { SCENES, TIMING } from './scenes'

export const FPS = 30

// shots.json (window size + per-shot geometry) is written by scripts/demo.sh next to the stills.
const calculateMetadata: CalculateMetadataFunction<DemoProps> = async () => {
  const data = await fetch(staticFile('shots.json')).then((r) => r.json())
  return {
    durationInFrames: SCENES.reduce((n, s) => n + TIMING[s.kind].frames, 0),
    props: { data }
  }
}

export function Root(): React.JSX.Element {
  return (
    <Composition
      id="LymuxDemo"
      component={Demo}
      width={1920}
      height={1080}
      fps={FPS}
      durationInFrames={1}
      defaultProps={{ data: null }}
      calculateMetadata={calculateMetadata}
    />
  )
}
