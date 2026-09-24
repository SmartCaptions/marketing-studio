import "./index.css";
import React from "react";
import { Composition } from "remotion";
import { ComponentGallery } from "./templates/ComponentGallery";
import { SocialClip, socialClipSchema } from "./templates/SocialClip";
import { ProductDemo, productDemoSchema } from "./templates/ProductDemo";
import { LogoReveal, logoRevealSchema } from "./templates/LogoReveal";
import { LaunchVideo, launchVideoSchema } from "./templates/LaunchVideo";
import { AnimatedOG, animatedOgSchema } from "./templates/AnimatedOG";
import { StoryReel, storyReelSchema } from "./templates/StoryReel";
import { HybridPost, hybridPostSchema } from "./templates/HybridPost";
import { launchTiming } from "./lib/launchTiming";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ComponentGallery"
        component={ComponentGallery}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="SocialClip"
        component={SocialClip}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        schema={socialClipSchema}
        defaultProps={{
          brandId: "noban",
          kicker: "noban.gg",
          headline: "Skin arbitrage with guardrails",
          lines: [
            "Scans CSFloat, Steam, and 7 more venues",
            "Float and pattern aware spreads",
            "Hard spend caps on every trade",
          ],
          screenshot: "noban/cockpit.webp",
          cta: "Free in simulation",
          burnCaptions: false,
          voLines: null,
          locale: null,
        }}
        calculateMetadata={({props}) => ({
          width: props.formatWidth ?? 1920,
          height: props.formatHeight ?? 1080,
        })}
      />
      <Composition
        id="ProductDemo"
        component={ProductDemo}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        schema={productDemoSchema}
        defaultProps={{
          brandId: "noban",
          video: null,
          cta: "Simulate free at noban.gg",
          telemetry: null,
          locale: null,
        }}
        calculateMetadata={({props}) => ({
          durationInFrames: props.telemetry
            ? Math.ceil((props.telemetry.durationMs / 1000) * 30) + 60
            : 240,
        })}
      />
      <Composition
        id="LogoReveal"
        component={LogoReveal}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        schema={logoRevealSchema}
        defaultProps={{
          brandId: "noban",
          sequence: null,
          frameCount: 90,
          cta: "Simulate free at noban.gg",
          motionOverride: null,
        }}
      />
      <Composition
        id="LaunchVideo"
        component={LaunchVideo}
        durationInFrames={1350}
        fps={30}
        width={1920}
        height={1080}
        schema={launchVideoSchema}
        defaultProps={{
          brandId: "noban",
          kicker: "noban.gg",
          headline: "CS2 skin arbitrage with guardrails",
          demo: {video: null, telemetry: null},
          features: [],
          cta: "Simulate free at noban.gg",
          assets: {logoSequence: null, logoFrames: 90, loopSequence: null, loopFrames: 240},
          audio: null,
          burnCaptions: false,
          motionOverride: null,
        }}
        calculateMetadata={({props}) => ({
          durationInFrames: launchTiming(
            props.demo.telemetry?.durationMs ?? null,
            props.features.length,
          ).total,
          width: props.formatWidth ?? 1920,
          height: props.formatHeight ?? 1080,
        })}
      />
      <Composition
        id="AnimatedOG"
        component={AnimatedOG}
        durationInFrames={240}
        fps={30}
        width={1200}
        height={630}
        schema={animatedOgSchema}
        defaultProps={{
          brandId: "noban",
          tagline: "CS2 skin arbitrage with guardrails",
          cta: "Simulate free at noban.gg",
          heroImage: null,
          loopSequence: null,
          loopFrames: 240,
          locale: null,
        }}
      />
      {/* StoryReel: 1080×1920 portrait reel for Instagram Reels / YouTube Shorts.
          Duration is computed from scene narration lengths via calculateMetadata.
          Default props render without network (no audio, placeholder scene). */}
      <Composition
        id="StoryReel"
        component={StoryReel}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1920}
        schema={storyReelSchema}
        defaultProps={{
          brandId: "smartcaptions",
          language: "he" as const,
          hook: "כתוביות לפרמייר פרו בלחיצה אחת",
          cta: "smartcaptions.co.il",
          aiDisclosure: false,
          hookDurationMs: 1000,
          endCardDurationMs: 2000,
          scenes: [
            {
              kind: "image" as const,
              media: "smartcaptions/placeholder.png",
              audioSrc: null,
              audioDurationMs: 3000,
              captions: [],
            },
          ],
        }}
        calculateMetadata={({props}) => {
          const fps = 30;
          const hookFrames = Math.ceil((props.hookDurationMs / 1000) * fps);
          const endFrames = Math.ceil((props.endCardDurationMs / 1000) * fps);
          const sceneFrames = props.scenes.reduce(
            (sum, s) => sum + Math.ceil((s.audioDurationMs / 1000) * fps),
            0,
          );
          return {durationInFrames: hookFrames + sceneFrames + endFrames};
        }}
      />

      {/* HybridPost — 1080×1920 social post with studio or collage look */}
      <Composition
        id="HybridPost"
        component={HybridPost}
        durationInFrames={270}
        fps={30}
        width={1080}
        height={1920}
        schema={hybridPostSchema}
        defaultProps={{
          brandId: "smartcaptions",
          language: "he" as const,
          look: "studio" as const,
          aiDisclosure: false,
          wordmarkSrc: null,
          attribution: null,
          shots: [
            {
              kind: "title" as const,
              narration: "שיר בדיקה",
              heading: "HybridPost",
              lines: ["demo post"],
              audioSrc: null,
              audioDurationMs: 3000,
              captions: [],
            },
            {
              kind: "end" as const,
              narration: "SmartCaptions",
              heading: "SmartCaptions",
              lines: ["AI Captions in Premiere Pro"],
              audioSrc: null,
              audioDurationMs: 4000,
              captions: [],
            },
          ],
        }}
        calculateMetadata={({props}) => {
          const fps = 30;
          const totalFrames = props.shots.reduce(
            (sum, s) => sum + Math.ceil((s.audioDurationMs / 1000) * fps),
            0,
          );
          return {durationInFrames: Math.max(30, totalFrames)};
        }}
      />
    </>
  );
};
