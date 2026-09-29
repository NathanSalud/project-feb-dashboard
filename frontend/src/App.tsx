import { useAuth } from './AuthContext';
import Login from './Login';
import Dashboard from './Dashboard';
import ConsentBanner from './ConsentBanner';

export default function App() {
  const { user } = useAuth();

  return (
    <>
      {!user ? <Login /> : <Dashboard />}
      <ConsentBanner />
    </>
  );
}
