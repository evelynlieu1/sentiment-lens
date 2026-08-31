import { Analyzer } from "@/components/dashboard/analyzer";
import { hasCredentials } from "@/lib/reddit";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { KeyRound } from "lucide-react";

export default function Home() {
  // Checked on the server so the warning reflects the actual runtime env.
  const credentialsMissing = !hasCredentials();

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          Sentiment Lens
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
          Paste a Reddit thread and read the room. Every comment is scored for sentiment
          by CardiffNLP&apos;s TweetEval RoBERTa and for emotion by a RoBERTa trained on
          Google&apos;s GoEmotions corpus — both open-weights, both running locally on
          your machine.
        </p>
      </header>

      {credentialsMissing ? (
        <Alert className="mb-6">
          <KeyRound />
          <AlertTitle>Running without Reddit API credentials</AlertTitle>
          <AlertDescription>
            The app will try Reddit&apos;s public JSON endpoint, but Reddit now blocks
            most anonymous reads, so expect HTTP 403. For reliable access, add <code className="font-mono">REDDIT_CLIENT_ID</code> and{" "}
            <code className="font-mono">REDDIT_CLIENT_SECRET</code> to{" "}
            <code className="font-mono">.env.local</code> — see the README for the
            two-minute setup.
          </AlertDescription>
        </Alert>
      ) : null}

      <Analyzer />
    </main>
  );
}
