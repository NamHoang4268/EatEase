import { ApiStatus } from '@/components/api-status';

export default function Home() {
  return (
    <main className="foundation-home">
      <p className="eyebrow">Restaurant platform foundation</p>
      <h1>EatEase</h1>
      <p>The web and API workspace is ready for milestone-driven development.</p>
      <ApiStatus />
    </main>
  );
}
