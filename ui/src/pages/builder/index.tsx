/* Job builder: ?job_id=<id> edits that job; no id starts a new, blank one, and ?import=1 one from a job pasted into Import jobs
 * or an example (?view= picks the view it opens in). */
import React from 'react';
import { queryParam, renderPage } from '../../components/PageShell';
import BuilderPage from '../../features/builder/BuilderPage';
import { takeImportedJob } from '../../features/builder/sourceLogic';

renderPage(<BuilderPage jobId={queryParam('job_id')} imported={queryParam('import') ? takeImportedJob() : null} initialView={queryParam('view')} />, 'Job builder');
