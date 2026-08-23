import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import States from './pages/States';
import Counties from './pages/Counties';
import TaxOfficials from './pages/TaxOfficials';
import ListRequests from './pages/ListRequests';
import FoiaTemplates from './pages/FoiaTemplates';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Layout>
          <Route path="/" component={Dashboard} />
          <Route path="/states" component={States} />
          <Route path="/counties" component={Counties} />
          <Route path="/tax-officials" component={TaxOfficials} />
          <Route path="/list-requests" component={ListRequests} />
          <Route path="/foia-templates" component={FoiaTemplates} />
        </Layout>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
