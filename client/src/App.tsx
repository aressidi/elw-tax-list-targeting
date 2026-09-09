import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route, Redirect } from 'wouter';
import Layout from './components/Layout';
import { ToastProvider } from './components/Toast';
import Dashboard from './pages/Dashboard';
import States from './pages/States';
import StateDetail from './pages/StateDetail';
import Counties from './pages/Counties';
import CountyDetail from './pages/CountyDetail';
import Contacts from './pages/Contacts';
import TaxOfficials from './pages/TaxOfficials';
import ListRequests from './pages/ListRequests';
import Templates from './pages/Templates';
import TemplateEditor from './pages/TemplateEditor';
import ResearchQueue from './pages/ResearchQueue';
import NewCountyWithResearch from './pages/NewCountyWithResearch';
import EmailCampaigns from './pages/EmailCampaigns';
import EmailQueue from './pages/EmailQueue';
import Responses from './pages/Responses';
import Reports from './pages/Reports';
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
            <Route path="/contacts" component={Contacts} />
            <Route path="/tax-officials" component={TaxOfficials} />
            <Route path="/list-requests" component={ListRequests} />
            <Route path="/templates" component={Templates} />
            <Route path="/templates/new" component={TemplateEditor} />
            <Route path="/templates/:id/edit" component={TemplateEditor} />
            <Route path="/foia-templates">
              <Redirect to="/templates" />
            </Route>
            <Route path="/research" component={ResearchQueue} />
            <Route path="/research-queue">
              <Redirect to="/research" />
            </Route>
            <Route path="/email-campaigns" component={EmailCampaigns} />
            <Route path="/email-queue" component={EmailQueue} />
            <Route path="/responses" component={Responses} />
            <Route path="/reports" component={Reports} />
            <Route path="/settings" component={Settings} />
          </Layout>
        </Router>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
