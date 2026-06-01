import { useAuth } from './AuthContext';
import Login from './Login';
import Dashboard from './Dashboard';

export default function App() {
  const { user } = useAuth();

  if (!user) return <Login />;
  return <Dashboard />;
}