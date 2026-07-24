/** Prevent year-long Full Route Cache of the sign-in shell (stale HTML → blank UI after deploy). */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SignInLayout({ children }) {
  return children;
}
