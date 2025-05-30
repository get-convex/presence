import { useAuthActions } from "@convex-dev/auth/react";

export function SignOut() {
  const { signOut } = useAuthActions();
  return <button onClick={() => void signOut()}>Sign out</button>;
}
