import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route, Redirect } from 'wouter';
import Layout from './components/Layout';
import { ToastProvider } from './components/Toast';
import Dashboard from './pages/Dashboard';
import States from './pages/States';
import StateDetail from './pages/StateDetail';
import Counties from './pages/Counties';
import CountyDetail from './pages/CountyDetail';
import TaxOfficials from './pages/TaxOfficials';
import ListRequests from './pages/ListRequests';
import FoiaTemplates from './pages/FoiaTemplates';
import ResearchQueue from './pages/ResearchQueue';
import NewCountyWithResearch from './pages/NewCountyWithResearch';
import EmailCampaigns from './pages/EmailCampaigns';
import Responses from './pages/Responses';
import Settings from './pages/Settings';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Router>
          <Layout>
            <Route path="/" component={Dashboard} />
            <Route path="/states" component={States} />
            <Route path="/states/:abbreviation" component={StateDetail} />
            <Route path="/counties" component={Counties} />
            <Route path="/counties/new-with-research" component={NewCountyWithResearch} />
            <Route path="/counties/:id" component={CountyDetail} />
            <Route path="/tax-officials" component={TaxOfficials} />
            <Route path="/list-requests" component={ListRequests} />
            <Route path="/foia-templates" component={FoiaTemplates} />
            <Route path="/research" component={ResearchQueue} />
            <Route path="/research-queue">
              <Redirect to="/research" />
            </Route>
            <Route path="/email-campaigns" component={EmailCampaigns} />
            <Route path="/responses" component={Responses} />
            <Route path="/settings" component={Settings} />
          </Layout>
        </Router>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
